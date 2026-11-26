import { createHash, createHmac } from "node:crypto";

export type AttachmentOssCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
};

type Query = Readonly<Record<string, string>>;
type RequestMethod = "DELETE" | "GET" | "HEAD" | "PUT";

const algorithm = "OSS4-HMAC-SHA256";
const scopeSuffix = "oss/aliyun_v4_request";
const unsignedPayload = "UNSIGNED-PAYLOAD";

const encodeComponent = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

const encodePath = (path: string) =>
  path.split("/").map(encodeComponent).join("/");

function encodeQuery(query: Query) {
  return Object.entries(query)
    .map(([key, value]) => [encodeComponent(key), encodeComponent(value)])
    .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

const timestamp = (date: Date) =>
  date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");

function signature(
  config: AttachmentOssCredentials,
  method: RequestMethod,
  objectKey: string,
  headers: Headers,
  query: Query,
  signingTime: string,
  additionalHeaders: string[] = []
) {
  const headerLines = [...headers.keys()]
    .filter(
      (name) =>
        name.startsWith("x-oss-") ||
        name === "content-type" ||
        name === "content-md5" ||
        additionalHeaders.includes(name)
    )
    .sort()
    .map((name) => `${name}:${headers.get(name)?.trim()}\n`)
    .join("");
  const canonicalRequest = [
    method,
    encodePath(`/${config.bucket}/${objectKey}`),
    encodeQuery(query),
    headerLines,
    additionalHeaders.join(";"),
    unsignedPayload,
  ].join("\n");
  const day = signingTime.slice(0, 8);
  const credentialScope = `${day}/${config.region}/${scopeSuffix}`;
  const stringToSign = [
    algorithm,
    signingTime,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  let key: string | Uint8Array = `aliyun_v4${config.accessKeySecret}`;
  for (const part of [day, config.region, "oss", "aliyun_v4_request"]) {
    key = createHmac("sha256", key).update(part).digest();
  }

  return createHmac("sha256", key).update(stringToSign).digest("hex");
}

const host = (config: AttachmentOssCredentials) =>
  `${config.bucket}.oss-${config.region}.aliyuncs.com`;

/**
 * 为后端发出的 OSS 请求创建 V4 签名。
 * @param config 已校验的 OSS 凭据与目标。
 * @param method 请求方法。
 * @param objectKey 桶内对象键。
 * @param headers 参与请求的额外头。
 * @param now 签名时间。
 * @returns 已构造好的对象 URL 与仅供服务端使用的签名请求头。
 */
export function signAttachmentOssRequest(
  config: AttachmentOssCredentials,
  method: RequestMethod,
  objectKey: string,
  headers: Headers,
  now: Date
) {
  const signingTime = timestamp(now);
  const scope = `${signingTime.slice(0, 8)}/${config.region}/${scopeSuffix}`;
  headers.set("x-oss-content-sha256", unsignedPayload);
  headers.set("x-oss-date", signingTime);
  const signed = signature(config, method, objectKey, headers, {}, signingTime);
  headers.set(
    "authorization",
    `${algorithm} Credential=${config.accessKeyId}/${scope},Signature=${signed}`
  );
  return { url: `https://${host(config)}/${encodePath(objectKey)}`, headers };
}

/**
 * 为浏览器生成短期 OSS V4 直传或下载地址。
 * @param config 已校验的 OSS 凭据与目标。
 * @param method `PUT` 直传或 `GET` 下载。
 * @param objectKey 桶内对象键。
 * @param options 有效期、签名时间以及与浏览器实际请求一致的签名头或下载参数。
 * @returns 带签名的 OSS 地址。
 */
export function presignAttachmentOssUrl(
  config: AttachmentOssCredentials,
  method: "GET" | "PUT",
  objectKey: string,
  options: {
    expiresInSeconds: number;
    now: Date;
    headers?: Headers;
    query?: Query;
  }
) {
  const headers = new Headers(options.headers);
  const hostname = host(config);
  headers.set("host", hostname);
  const additionalHeaders = headers.has("content-length")
    ? ["content-length", "host"]
    : ["host"];
  const signingTime = timestamp(options.now);
  const scope = `${signingTime.slice(0, 8)}/${config.region}/${scopeSuffix}`;
  const query = {
    ...options.query,
    "x-oss-additional-headers": additionalHeaders.join(";"),
    "x-oss-credential": `${config.accessKeyId}/${scope}`,
    "x-oss-date": signingTime,
    "x-oss-expires": String(options.expiresInSeconds),
    "x-oss-signature-version": algorithm,
  };
  const signed = signature(
    config,
    method,
    objectKey,
    headers,
    query,
    signingTime,
    additionalHeaders
  );
  return `https://${hostname}/${encodePath(objectKey)}?${encodeQuery({
    ...query,
    "x-oss-signature": signed,
  })}`;
}

/**
 * 生成保留中文名的下载响应头，去掉文件名中的控制字符及路径分隔符。
 * @param fileName 已保存的原文件名。
 * @returns 按 RFC 5987 编码的 Content-Disposition。
 */
export function attachmentDownloadDisposition(fileName: string) {
  const cleaned = fileName
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+|[\s.]+$/gu, "");
  const characters = Array.from(cleaned);
  const extension = cleaned.match(/\.[a-z0-9]{1,16}$/iu)?.[0] ?? "";
  const name =
    characters.length > 180
      ? `${characters.slice(0, 180 - extension.length).join("")}${extension}`
      : cleaned || "attachment";
  return `attachment; filename*=UTF-8''${encodeComponent(name)}`;
}
