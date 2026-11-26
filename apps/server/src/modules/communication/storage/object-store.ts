import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { createLocalAttachmentStorage } from "./local-files";
import {
  attachmentDownloadDisposition,
  presignAttachmentOssUrl,
  signAttachmentOssRequest,
  type AttachmentOssCredentials,
} from "./oss-signing";

const objectPrefix = "communication/attachments/";
const uploadLifetimeSeconds = 15 * 60;
const downloadLifetimeSeconds = 90;
const requestTimeoutMs = 5_000;
const copyTimeoutMs = 10 * 60_000;
const maxXmlBytes = 64 * 1024;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const storageKeyPattern = new RegExp(`^([0-9a-f]{2})/${uuid}/(${uuid})$`, "u");

type StorageMethod = "DELETE" | "GET" | "HEAD" | "PUT";
type StorageFetch = (url: string, init: RequestInit) => Promise<Response>;

/** 存储错误只携带操作和可选状态码，避免返回带签名的 URL、响应体或凭据。 */
export class AttachmentStorageError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

function objectKey(storageKey: string, staging = false) {
  const match = storageKeyPattern.exec(storageKey);
  if (!match || match[1] !== match[2].slice(0, 2)) {
    throw new AttachmentStorageError("附件对象键无效。");
  }
  return `${objectPrefix}${staging ? "single-staging/" : ""}${storageKey}`;
}

function readLength(value: string | null | undefined) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

const discard = (response: Response) =>
  response.body?.cancel().catch(() => undefined);

async function readXml(response: Response, controller: AbortController) {
  if (!response.body) return "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let length = 0;
  let xml = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return xml + decoder.decode();
      length += value.byteLength;
      if (length > maxXmlBytes) {
        controller.abort();
        throw new AttachmentStorageError("附件存储响应超过限制。");
      }
      xml += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function withStorageTimeout<T>(
  controller: AbortController,
  ms: number,
  work: () => Promise<T>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AttachmentStorageError("附件存储操作超时。"));
    }, ms);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function idleStream(
  stream: ReadableStream<Uint8Array>,
  controller: AbortController
) {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const { done, value } = await withStorageTimeout(
          controller,
          requestTimeoutMs,
          () => reader.read()
        );
        if (done) output.close();
        else output.enqueue(value);
      } catch {
        controller.abort();
        output.error(new AttachmentStorageError("读取附件内容失败，请重试。"));
      }
    },
    async cancel() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
  });
}

function timeOfSigning(now: () => Date) {
  return new Date(Math.floor(now().getTime() / 1000) * 1000);
}

/**
 * 构建私有 OSS 适配器。上传地址只签暂存对象，正式对象只由服务端写入。
 * @param rawConfig OSS 账号、Bucket 和地域，地域可带 oss- 前缀。
 * @param request 可注入的 HTTP 传输，普通运行时默认使用 fetch。
 * @param now 签名时钟，默认使用当前时间。
 * @returns 生成上传或下载签名，以及读取、转正和清理对象的方法。
 * @throws 配置无效时抛出 `AttachmentStorageError`。
 */
export function createAttachmentStorage(
  rawConfig: AttachmentOssCredentials,
  request: StorageFetch = fetch,
  now: () => Date = () => new Date()
) {
  const config = {
    ...rawConfig,
    region: rawConfig.region.replace(/^oss-/u, ""),
  };
  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(config.bucket) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(config.region) ||
    !/^[a-zA-Z0-9._-]+$/u.test(config.accessKeyId) ||
    !config.accessKeySecret.trim()
  ) {
    throw new AttachmentStorageError("附件 OSS 配置无效。");
  }

  async function send<T>(
    method: StorageMethod,
    key: string,
    handle: (response: Response, controller: AbortController) => Promise<T>,
    headers = new Headers(),
    timeoutMs = requestTimeoutMs
  ) {
    const signed = signAttachmentOssRequest(
      config,
      method,
      key,
      headers,
      now()
    );
    const controller = new AbortController();
    try {
      return await withStorageTimeout(controller, timeoutMs, async () => {
        const response = await request(signed.url, {
          method,
          headers: signed.headers,
          signal: controller.signal,
          redirect: "error",
        });
        return await handle(response, controller);
      });
    } catch (error) {
      controller.abort();
      if (error instanceof AttachmentStorageError) throw error;
      throw new AttachmentStorageError(`附件存储请求失败（${method}）。`);
    }
  }

  const rejectResponse = (status: number) =>
    new AttachmentStorageError(`附件存储请求失败（HTTP ${status}）。`, status);

  async function readMetadata(key: string) {
    const head = await send("HEAD", key, async (response) => {
      await discard(response);
      if (response.status === 404) return null;
      if (!response.ok) throw rejectResponse(response.status);
      return {
        contentLength: readLength(response.headers.get("content-length")),
      };
    });
    if (head === null) return null;
    if (head.contentLength !== null)
      return { contentLength: head.contentLength };
    // 部分网关会移除 HEAD 的 Content-Length，改用范围读取确认实际对象长度。
    return send(
      "GET",
      key,
      async (response) => {
        await discard(response);
        if (response.status === 404) return null;
        const range = response.headers.get("content-range");
        const total = readLength(
          range?.match(/^bytes (?:\d+-\d+|\*)\/(\d+)$/u)?.[1]
        );
        if (
          total !== null &&
          (response.status === 206 || (response.status === 416 && total === 0))
        ) {
          return { contentLength: total };
        }
        throw rejectResponse(response.status);
      },
      new Headers({ range: "bytes=0-0" })
    );
  }

  async function remove(key: string) {
    await send("DELETE", key, async (response, controller) => {
      if (response.ok) {
        await discard(response);
        return;
      }
      if (response.status === 404) {
        const xml = await readXml(response, controller);
        const code = xml.match(/<Code>([^<]+)<\/Code>/u)?.[1];
        // 删除已不存在的对象可重试收敛，但错误 Bucket 不能记作清理成功。
        if (!code || code === "NoSuchKey") return;
      } else {
        await discard(response);
      }
      throw rejectResponse(response.status);
    });
  }

  return {
    kind: "oss" as const,
    createSingleUploadRequest(
      storageKey: string,
      fileSize: number,
      mimeType: string
    ) {
      const signedAt = timeOfSigning(now);
      const headers = {
        "content-type": mimeType,
        "x-oss-forbid-overwrite": "true",
        "x-oss-object-acl": "private",
      };
      return {
        url: presignAttachmentOssUrl(
          config,
          "PUT",
          objectKey(storageKey, true),
          {
            headers: new Headers({
              ...headers,
              "content-length": String(fileSize),
            }),
            expiresInSeconds: uploadLifetimeSeconds,
            now: signedAt,
          }
        ),
        headers,
        expiresAt: new Date(signedAt.getTime() + uploadLifetimeSeconds * 1000),
      };
    },
    createDownloadUrl(storageKey: string, fileName: string) {
      const signedAt = timeOfSigning(now);
      return {
        downloadUrl: presignAttachmentOssUrl(
          config,
          "GET",
          objectKey(storageKey),
          {
            expiresInSeconds: downloadLifetimeSeconds,
            now: signedAt,
            query: {
              "response-cache-control": `private, max-age=${downloadLifetimeSeconds}, no-transform`,
              "response-content-disposition":
                attachmentDownloadDisposition(fileName),
            },
          }
        ),
        expiresAt: new Date(
          signedAt.getTime() + downloadLifetimeSeconds * 1000
        ),
      };
    },
    readMetadata: (storageKey: string) => readMetadata(objectKey(storageKey)),
    readSingleUploadMetadata: (storageKey: string) =>
      readMetadata(objectKey(storageKey, true)),
    openReadStream: (storageKey: string) =>
      send("GET", objectKey(storageKey), async (response, controller) => {
        if (response.status === 404) {
          await discard(response);
          return null;
        }
        if (!response.ok || !response.body) {
          await discard(response);
          throw rejectResponse(response.status);
        }
        return {
          body: idleStream(response.body, controller),
          contentLength: readLength(response.headers.get("content-length")),
        };
      }),
    promoteSingleUpload: (storageKey: string) =>
      send(
        "PUT",
        objectKey(storageKey),
        async (response, controller) => {
          const xml = await readXml(response, controller);
          if (!response.ok || /<Error(?:[>\s])/u.test(xml)) {
            throw rejectResponse(response.status);
          }
        },
        new Headers({
          "x-oss-copy-source": `/${config.bucket}/${objectKey(storageKey, true)}`,
          "x-oss-forbid-overwrite": "true",
          "x-oss-object-acl": "private",
        }),
        copyTimeoutMs
      ),
    remove: (storageKey: string) => remove(objectKey(storageKey)),
    removeSingleUpload: (storageKey: string) =>
      remove(objectKey(storageKey, true)),
  };
}

export type AttachmentStorage =
  | ReturnType<typeof createAttachmentStorage>
  | ReturnType<typeof createLocalAttachmentStorage>;

const sourceWorkspace = resolve(import.meta.dir, "../../../../../..");
const developmentWorkspace = [sourceWorkspace, process.cwd()].find((root) =>
  existsSync(join(root, "apps/client/vite.config.ts"))
);

function realDirectoryPath(directory: string): string {
  try {
    return realpathSync(directory);
  } catch (error) {
    const parent = dirname(directory);
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      parent === directory
    ) {
      throw error;
    }
    return join(realDirectoryPath(parent), basename(directory));
  }
}

function localStorageDirectory(value: string) {
  const directory = resolve(value);
  if (!developmentWorkspace) return directory;

  // Vite 默认允许读取整个工作区，附件目录必须在该范围之外。
  const root = realpathSync(developmentWorkspace);
  const within = (rootPath: string, filePath: string) => {
    const path = relative(rootPath, filePath);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  if (
    within(developmentWorkspace, directory) ||
    within(root, realDirectoryPath(directory))
  ) {
    throw new AttachmentStorageError("本地附件目录必须位于开发工作区之外。");
  }
  return directory;
}

/**
 * 在真正需要访问附件存储时读取后端配置。
 * @returns 当前模式的存储适配器，未指定模式时沿用 OSS。
 * @throws 模式未知或缺少所选模式的配置时抛出不包含配置值的错误。
 */
export function attachmentStorageFromEnv(): AttachmentStorage {
  const read = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new AttachmentStorageError(`缺少附件存储配置 ${name}。`);
    return value;
  };
  const mode = process.env.COMMUNICATION_ATTACHMENT_STORAGE?.trim() || "oss";
  if (mode === "local") {
    return createLocalAttachmentStorage(
      localStorageDirectory(read("COMMUNICATION_ATTACHMENT_LOCAL_DIR"))
    );
  }
  if (mode !== "oss") throw new AttachmentStorageError("附件存储模式无效。");
  return createAttachmentStorage({
    accessKeyId: read("OSS_ACCESS_KEY_ID"),
    accessKeySecret: read("OSS_ACCESS_KEY_SECRET"),
    bucket: read("OSS_BUCKET"),
    region: read("OSS_REGION"),
  });
}

export type GetAttachmentStorage = () => AttachmentStorage;
