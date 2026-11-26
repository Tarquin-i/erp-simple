import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const storageKeyPattern = new RegExp(`^([0-9a-f]{2})/${uuid}/(${uuid})$`, "u");
const readChunkBytes = 64 * 1024;

/** 请求实际传入的字节数与附件声明的大小不符。 */
export class LocalAttachmentSizeError extends Error {
  constructor() {
    super("附件实际大小与声明不一致。");
  }
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

async function privateDirectory(
  path: string,
  create: boolean,
  recursive = false
) {
  if (create) {
    try {
      await mkdir(path, { mode: 0o700, recursive });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    }
  }
  const entry = await lstat(path).catch((error: unknown) => {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  });
  if (!entry) return false;
  if (!entry.isDirectory() || (entry.mode & 0o077) !== 0) {
    throw new Error("附件存储目录必须为私有目录。");
  }
  return true;
}

function privateFileSize(file: {
  isFile(): boolean;
  mode: number;
  size: number;
}) {
  if (!file.isFile() || (file.mode & 0o077) !== 0) {
    throw new Error("附件对象必须为私有普通文件。");
  }
  return file.size;
}

async function readFileSize(path: string | null) {
  if (!path) return null;
  try {
    return privateFileSize(await lstat(path));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function removeFile(path: string | null) {
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

/**
 * 在私有目录内保存附件字节，暂存与正式对象使用同一个文件系统。
 * @param directory 存储根目录的绝对路径，既有目录需仅对服务用户开放。
 * @returns 流式写入、读取、转正和清理本地附件的方法。
 * @throws 根目录路径无效时抛出异常。文件操作失败由调用方统一处理。
 */
export function createLocalAttachmentStorage(directory: string) {
  if (!isAbsolute(directory)) throw new Error("附件存储目录必须使用绝对路径。");
  const root = resolve(directory);

  async function objectPath(
    storageKey: string,
    staging: boolean,
    create = false
  ) {
    const match = storageKeyPattern.exec(storageKey);
    if (match?.[0] !== storageKey || match[1] !== match[2].slice(0, 2)) {
      throw new Error("附件对象键无效。");
    }
    if (!(await privateDirectory(root, create, true))) return null;

    const segments = storageKey.split("/").slice(0, -1);
    const fileName = match[2];
    if (staging) segments.unshift("single-staging");
    let parent = root;
    for (const segment of segments) {
      parent = join(parent, segment);
      if (!(await privateDirectory(parent, create))) return null;
    }
    return join(parent, fileName);
  }

  async function readMetadata(storageKey: string, staging: boolean) {
    const contentLength = await readFileSize(
      await objectPath(storageKey, staging)
    );
    return contentLength === null ? null : { contentLength };
  }

  return {
    kind: "local" as const,
    /**
     * 将请求体流式写入暂存对象。完整写入且大小相符后才公开暂存路径。
     * @param storageKey 数据库分配的对象键。
     * @param expectedSize 初始化声明的字节数。
     * @param body 请求体二进制流。
     * @param signal 可选的请求取消信号。
     * @returns `written` 表示成功，`exists` 表示已有同键暂存对象。
     * @throws 实际字节数不符时抛出 `LocalAttachmentSizeError`。
     */
    async writeSingleUpload(
      storageKey: string,
      expectedSize: number,
      body: ReadableStream<Uint8Array>,
      signal?: AbortSignal
    ) {
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
        throw new LocalAttachmentSizeError();
      }
      signal?.throwIfAborted();
      const staging = await objectPath(storageKey, true, true);
      if (!staging) throw new Error("无法创建附件暂存目录。");
      if ((await readFileSize(staging)) !== null) return "exists" as const;

      const temporary = join(dirname(staging), `.upload-${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try {
        try {
          const reader = body.getReader();
          const cancel = () => void reader.cancel().catch(() => undefined);
          signal?.addEventListener("abort", cancel, { once: true });
          let size = 0;
          let finished = false;
          try {
            signal?.throwIfAborted();
            for (;;) {
              const { done, value } = await reader.read();
              signal?.throwIfAborted();
              if (done) break;
              size += value.byteLength;
              if (size > expectedSize) throw new LocalAttachmentSizeError();

              let offset = 0;
              while (offset < value.byteLength) {
                const { bytesWritten } = await file.write(
                  value,
                  offset,
                  value.byteLength - offset
                );
                if (bytesWritten === 0)
                  throw new Error("写入附件暂存文件失败。");
                offset += bytesWritten;
              }
            }
            finished = true;
          } finally {
            signal?.removeEventListener("abort", cancel);
            if (!finished) cancel();
            reader.releaseLock();
          }
          if (size !== expectedSize) throw new LocalAttachmentSizeError();
        } finally {
          await file.close();
        }

        signal?.throwIfAborted();
        // 硬链接原子地占用同键路径，两个请求同时写入也只有一个成功。
        await link(temporary, staging);
        return "written" as const;
      } catch (error) {
        if (
          hasErrorCode(error, "EEXIST") &&
          (await readFileSize(staging)) !== null
        ) {
          return "exists" as const;
        }
        throw error;
      } finally {
        await removeFile(temporary);
      }
    },
    readMetadata: (storageKey: string) => readMetadata(storageKey, false),
    readSingleUploadMetadata: (storageKey: string) =>
      readMetadata(storageKey, true),
    /** 从同一个文件句柄读取大小和内容，取消或读完即关闭句柄。 */
    async openReadStream(storageKey: string) {
      const path = await objectPath(storageKey, false);
      if (!path) return null;
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      ).catch((error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) return null;
        throw error;
      });
      if (!file) return null;

      try {
        const contentLength = privateFileSize(await file.stat());
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const buffer = new Uint8Array(readChunkBytes);
              const { bytesRead } = await file.read(buffer, 0, buffer.length);
              if (bytesRead > 0) {
                controller.enqueue(buffer.subarray(0, bytesRead));
                return;
              }
              await file.close();
              controller.close();
            } catch {
              await file.close().catch(() => undefined);
              controller.error(new Error("读取本地附件失败。"));
            }
          },
          cancel: () => file.close(),
        });
        return { body, contentLength };
      } catch (error) {
        await file.close().catch(() => undefined);
        throw error;
      }
    },
    /** 将暂存对象转正。重试时已有正式对象仍保持原样。 */
    async promoteSingleUpload(storageKey: string) {
      const formal = await objectPath(storageKey, false, true);
      if (!formal) throw new Error("无法创建附件存储目录。");
      if ((await readFileSize(formal)) !== null) return;
      const staging = await objectPath(storageKey, true);
      if (!staging || (await readFileSize(staging)) === null) {
        if ((await readFileSize(formal)) !== null) return;
        throw new Error("附件暂存对象不存在。");
      }
      try {
        await link(staging, formal);
      } catch (error) {
        if (
          (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOENT")) &&
          (await readFileSize(formal)) !== null
        ) {
          return;
        }
        throw error;
      }
    },
    remove: async (storageKey: string) =>
      removeFile(await objectPath(storageKey, false)),
    removeSingleUpload: async (storageKey: string) =>
      removeFile(await objectPath(storageKey, true)),
  };
}
