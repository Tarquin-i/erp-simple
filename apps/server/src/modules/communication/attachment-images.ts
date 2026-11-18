import { HTTPException } from "hono/http-exception";
import sharp from "sharp";

import { fail } from "../organization/errors";

const imageFormats = new Map([
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/tiff", "tiff"],
  ["image/webp", "webp"],
]);

const thumbnailEdge = 512;
const maxThumbnailSourceBytes = 20 * 1024 ** 2;
const maxBmpThumbnailBytes = 512 * 1024;
const maxThumbnailOutputBytes = 1024 ** 2;
const maxThumbnailPixels = 25_000_000;
const maxActiveThumbnails = 8;
let activeThumbnails = 0;

type ImageSource = {
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
};

function imageHeaders(mimeType: string, contentLength: number | null) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Content-Type": mimeType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentLength !== null) {
    headers.set("Content-Length", String(contentLength));
  }
  return headers;
}

async function openImage(
  openSource: () => Promise<ImageSource | null>,
  fileSize: number,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const source = await openSource();
  if (!source) fail(404, "附件文件不存在。");
  if (
    signal.aborted ||
    (source.contentLength !== null && source.contentLength !== fileSize)
  ) {
    await source.body.cancel().catch(() => undefined);
    signal.throwIfAborted();
    throw new Error("图片大小与已验证的附件不一致。");
  }
  return source;
}

async function readImageBytes(
  body: ImageSource["body"],
  fileSize: number,
  signal: AbortSignal
) {
  const bytes = new Uint8Array(fileSize);
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  let offset = 0;
  let finished = false;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > fileSize) {
        throw new Error("图片大小与已验证的附件不一致。");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    finished = true;
    if (offset !== fileSize) throw new Error("图片大小与已验证的附件不一致。");
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) cancel();
    reader.releaseLock();
  }
}

async function resizeImage(bytes: Uint8Array, format: string) {
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: maxThumbnailPixels,
      pages: 1,
      sequentialRead: true,
    }).timeout({ seconds: 5 });
    if ((await image.metadata()).format !== format) {
      fail(415, "图片内容与格式不匹配。");
    }
    return await image
      .autoOrient()
      .resize(thumbnailEdge, thumbnailEdge, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 68 })
      .toBuffer();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return fail(415, "无法生成该图片的缩略图。");
  }
}

/**
 * 为已通过沟通权限检查的图片生成响应，原图直接流式读取。
 * @param file 已验证的附件类型和大小。
 * @param variant `thumbnail` 生成缩略图，`preview` 读取原图。
 * @param openSource 从当前存储打开正式对象的函数。
 * @param signal 请求取消信号。
 * @returns 不允许缓存的内联图片响应。
 * @throws 文件不存在时返回 404，无法处理的图片返回 415，生成任务繁忙时返回 503。
 */
export async function attachmentImageResponse(
  file: { fileSize: number; mimeType: string },
  variant: "thumbnail" | "preview",
  openSource: () => Promise<ImageSource | null>,
  signal: AbortSignal
) {
  const { fileSize, mimeType } = file;
  const format = imageFormats.get(mimeType);
  if (!format) fail(415, "该附件类型不支持图片预览。");
  if (variant === "preview") {
    const source = await openImage(openSource, fileSize, signal);
    return new Response(source.body, {
      headers: imageHeaders(mimeType, source.contentLength),
    });
  }

  // Sharp 无 BMP 解码器，仅以内联小 BMP 作为缩略图位置的后备。
  const maxSourceBytes =
    format === "bmp" ? maxBmpThumbnailBytes : maxThumbnailSourceBytes;
  if (fileSize === 0 || fileSize > maxSourceBytes) {
    fail(415, "该图片大小超出缩略图处理范围，请查看原图或下载。");
  }
  if (activeThumbnails >= maxActiveThumbnails) {
    throw new HTTPException(503, {
      res: Response.json(
        { message: "缩略图生成繁忙，请稍后重试。" },
        { status: 503 }
      ),
    });
  }

  // 限制同时读取与解码的输入，避免多个大文件并发耗尽内存。
  activeThumbnails += 1;
  try {
    const source = await openImage(openSource, fileSize, signal);
    const bytes = await readImageBytes(source.body, fileSize, signal);
    signal.throwIfAborted();
    if (format === "bmp") {
      return new Response(bytes, {
        headers: imageHeaders(mimeType, bytes.length),
      });
    }
    const thumbnail = await resizeImage(bytes, format);
    signal.throwIfAborted();
    if (thumbnail.byteLength > maxThumbnailOutputBytes) {
      fail(415, "该图片的缩略图过大。");
    }
    return new Response(thumbnail, {
      headers: imageHeaders("image/webp", thumbnail.byteLength),
    });
  } finally {
    activeThumbnails -= 1;
  }
}
