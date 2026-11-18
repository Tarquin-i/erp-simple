import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { toUSVString } from "node:util";
import { HTTPException } from "hono/http-exception";

import { readString, readUuid } from "../customer/input";
import { fail } from "../organization/errors";

export const attachmentUploadFields = [
  "fileName",
  "fileSize",
  "mimeType",
  "contentSha256",
  "uploadClientId",
] as const;

const maxSingleUploadBytes = 5 * 1024 ** 3;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const octetStream = "application/octet-stream";
const mimeTypesByExtension: Partial<Record<string, readonly string[]>> = {
  ".ai": ["application/postscript", "application/pdf"],
  ".bmp": ["image/bmp"],
  ".csv": ["text/csv", "application/csv", "application/vnd.ms-excel"],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".gif": ["image/gif"],
  ".jpeg": ["image/jpeg"],
  ".jpg": ["image/jpeg"],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
  ".txt": ["text/plain"],
  ".webp": ["image/webp"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

export type AttachmentUploadInput = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  expectedContentSha256: string;
  uploadClientId: string;
};

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

/** 读取可选的上传大小限制。无效的限制返回 503，避免静默放宽配置。 */
function attachmentUploadLimit() {
  const configured = process.env.COMMUNICATION_ATTACHMENT_MAX_BYTES?.trim();
  if (!configured) return maxSingleUploadBytes;
  const limit = Number(configured);
  if (!/^\d+$/u.test(configured) || limit < 1 || limit > maxSingleUploadBytes) {
    throw new HTTPException(503, {
      res: Response.json(
        { message: "附件大小限制配置无效。" },
        { status: 503 }
      ),
    });
  }
  return limit;
}

/**
 * 清理文件名并验证单次直传请求。
 * @param input 原始 JSON 元数据。contentSha256 是客户端计算的小写十六进制摘要。
 * @returns 可写入上传记录的标准化元数据。
 * @throws 文件名、文件类型、大小、摘要或上传 ID 不匹配时抛出 HTTP 400。
 */
export function readAttachmentUpload(
  input: Record<string, unknown>
): AttachmentUploadInput {
  if (typeof input.fileName !== "string") fail(400, "请填写附件文件名。");
  const baseName = input.fileName.split(/[\\/]/u).at(-1) ?? "";
  const safeName = [...toUSVString(baseName)]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  const fileName = readString(safeName, "附件文件名", 512);
  const acceptedTypes = mimeTypesByExtension[extensionOf(fileName)];
  if (!acceptedTypes) fail(400, "不支持该附件类型。");

  const declaredType = readString(input.mimeType, "附件类型", 255)
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const mimeType =
    declaredType === octetStream ? acceptedTypes[0] : declaredType;
  if (!acceptedTypes.includes(mimeType)) {
    fail(400, "附件扩展名与文件类型不匹配。");
  }

  const { fileSize, contentSha256 } = input;
  if (
    typeof fileSize !== "number" ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    fileSize > attachmentUploadLimit()
  ) {
    fail(400, "附件大小超出允许范围。");
  }
  if (
    typeof contentSha256 !== "string" ||
    contentSha256.length !== 64 ||
    !sha256Pattern.test(contentSha256)
  ) {
    fail(400, "请提交有效的附件 SHA-256 摘要。");
  }
  return {
    fileName,
    fileSize,
    mimeType,
    expectedContentSha256: contentSha256,
    uploadClientId: readUuid(input.uploadClientId, "上传 ID"),
  };
}

const zipExtensions = new Set([".docx", ".pptx", ".xlsx", ".zip"]);
const officeDirectories: Partial<Record<string, string>> = {
  ".docx": "word/",
  ".pptx": "ppt/",
  ".xlsx": "xl/",
};
const zipLocalFileHeader = [0x50, 0x4b, 0x03, 0x04];
const zipEndOfDirectory = [0x50, 0x4b, 0x05, 0x06];
const zipEndOfDirectoryBytes = Buffer.from(zipEndOfDirectory);
const prefixSampleBytes = 256 * 1024;
const suffixSampleBytes = 1024 * 1024;

function hasFileSignature(extension: string, head: Buffer) {
  const startsWith = (signature: string | number[], offset = 0) => {
    if (typeof signature !== "string") {
      return signature.every((byte, index) => head[offset + index] === byte);
    }
    const expected = Buffer.from(signature);
    return head.subarray(offset, offset + expected.length).equals(expected);
  };
  switch (extension) {
    case ".ai":
      return startsWith("%PDF-") || startsWith("%!PS-Adobe-");
    case ".bmp":
      return startsWith("BM");
    case ".doc":
    case ".ppt":
    case ".xls":
      return startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case ".gif":
      return startsWith("GIF87a") || startsWith("GIF89a");
    case ".jpeg":
    case ".jpg":
      return startsWith([0xff, 0xd8, 0xff]);
    case ".pdf":
      return startsWith("%PDF-");
    case ".png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".tif":
    case ".tiff":
      return (
        startsWith([0x49, 0x49, 0x2a, 0x00]) ||
        startsWith([0x4d, 0x4d, 0x00, 0x2a])
      );
    case ".webp":
      return startsWith("RIFF") && startsWith("WEBP", 8);
    case ".docx":
    case ".pptx":
    case ".xlsx":
    case ".zip":
      return startsWith(zipLocalFileHeader) || startsWith(zipEndOfDirectory);
    default:
      return false;
  }
}

function writeSuffix(buffer: Buffer, incoming: Uint8Array, offset: number) {
  const chunk = incoming.subarray(Math.max(0, incoming.length - buffer.length));
  const firstLength = Math.min(chunk.length, buffer.length - offset);
  buffer.set(chunk.subarray(0, firstLength), offset);
  if (firstLength < chunk.length) buffer.set(chunk.subarray(firstLength), 0);
  return (offset + chunk.length) % buffer.length;
}

function validateText(decoder: TextDecoder, chunk?: Uint8Array) {
  if (chunk?.includes(0)) fail(400, "附件文本包含不支持的空字符。");
  try {
    decoder.decode(chunk, { stream: chunk !== undefined });
  } catch {
    fail(400, "附件文本编码无效。");
  }
}

type AttachmentContent = Pick<
  AttachmentUploadInput,
  "fileName" | "fileSize" | "expectedContentSha256"
>;

/**
 * 流式核对 OSS 文件的大小、摘要、文件签名，以及文本编码和 Office/ZIP 头尾特征。
 * @param file 初始化上传时记录的文件名、大小和预期 SHA-256。
 * @param body 从 OSS 正式对象读取到的流。
 * @returns 经服务器计算并核对的 SHA-256 摘要。
 * @throws 内容不符时抛出 HTTP 400；OSS 流的读取异常交给调用方处理。
 */
export async function verifyAttachmentContent(
  file: AttachmentContent,
  body: ReadableStream<Uint8Array>
) {
  const extension = extensionOf(file.fileName);
  const decoder =
    extension === ".csv" || extension === ".txt"
      ? new TextDecoder("utf-8", { fatal: true })
      : undefined;
  const zipBased = zipExtensions.has(extension);
  const head = Buffer.alloc(
    Math.min(file.fileSize, decoder ? 0 : zipBased ? prefixSampleBytes : 16)
  );
  const tail = Buffer.alloc(
    Math.min(file.fileSize, zipBased ? suffixSampleBytes : 0)
  );
  const hash = createHash("sha256");
  const reader = body.getReader();
  let bytesRead = 0;
  let tailOffset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const offset = bytesRead;
      bytesRead += value.byteLength;
      if (bytesRead > file.fileSize) fail(400, "附件大小对不上，请重新上传。");
      if (decoder) validateText(decoder, value);
      if (offset < head.length) {
        head.set(value.subarray(0, head.length - offset), offset);
      }
      if (tail.length) tailOffset = writeSuffix(tail, value, tailOffset);
      hash.update(value);
    }
    if (decoder) validateText(decoder);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (bytesRead !== file.fileSize) fail(400, "附件大小对不上，请重新上传。");
  if (!decoder && !hasFileSignature(extension, head)) {
    fail(400, "附件实际内容与文件类型不匹配。");
  }
  if (zipBased) {
    const end = tailOffset
      ? Buffer.concat([tail.subarray(tailOffset), tail.subarray(0, tailOffset)])
      : tail;
    const officeDirectory = officeDirectories[extension];
    if (
      !(
        head.includes(zipEndOfDirectoryBytes) ||
        end.includes(zipEndOfDirectoryBytes)
      ) ||
      (officeDirectory &&
        !["[Content_Types].xml", officeDirectory].every(
          (marker) => head.includes(marker) || end.includes(marker)
        ))
    ) {
      fail(400, "附件实际内容与文件类型不匹配。");
    }
  }
  const digest = hash.digest("hex");
  if (digest !== file.expectedContentSha256) {
    fail(400, "附件内容与上传声明不一致，请重新选择文件。");
  }
  return digest;
}
