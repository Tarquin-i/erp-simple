import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { createCommunicationError } from "../application/errors";
import { extensionOf } from "../domain/attachment-files";
import type { AttachmentUploadInput } from "../domain/attachment-files";

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
  if (chunk?.includes(0)) {
    throw createCommunicationError("attachmentTextContainsNull");
  }
  try {
    decoder.decode(chunk, { stream: chunk !== undefined });
  } catch {
    throw createCommunicationError("attachmentTextInvalidEncoding");
  }
}

type AttachmentContent = Pick<
  AttachmentUploadInput,
  "fileName" | "fileSize" | "expectedContentSha256"
>;

/**
 * 流式核对附件文件的大小、摘要、文件签名，以及文本编码和 Office/ZIP 头尾特征。
 * @param file 初始化上传时记录的文件名、大小和预期 SHA-256。
 * @param body 从存储中读取到的流。
 * @returns 经服务器计算并核对的 SHA-256 摘要。
 * @throws 内容不符时抛出附件校验错误；存储流的读取异常交给调用方处理。
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
      if (bytesRead > file.fileSize)
        throw createCommunicationError("attachmentContentLengthMismatch");
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

  if (bytesRead !== file.fileSize)
    throw createCommunicationError("attachmentContentLengthMismatch");
  if (!decoder && !hasFileSignature(extension, head)) {
    throw createCommunicationError("attachmentContentTypeMismatch");
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
      throw createCommunicationError("attachmentContentTypeMismatch");
    }
  }
  const digest = hash.digest("hex");
  if (digest !== file.expectedContentSha256) {
    throw createCommunicationError("attachmentChecksumMismatch");
  }
  return digest;
}
