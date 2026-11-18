import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { CommunicationApiError } from "./communication";

export type Attachment = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderUserId: string;
  uploaderName: string;
  uploadedAt: string | null;
  deletionPending: boolean;
};

type AttachmentPage = { page?: number; pageSize?: number };

export type AttachmentListResult = Required<AttachmentPage> & {
  attachments: Attachment[];
  total: number;
};

export type AttachmentUploadInput = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  contentSha256: string;
  uploadClientId: string;
};

export type SignedAttachmentUpload = {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type AttachmentUploadSession = {
  attachmentId: string;
  mode: "single";
  uploadClientId: string;
  upload: SignedAttachmentUpload | null;
};

export const attachmentAccept =
  ".ai,.bmp,.csv,.doc,.docx,.gif,.jpeg,.jpg,.pdf,.png,.ppt,.pptx,.tif,.tiff,.txt,.webp,.xls,.xlsx,.zip";

const attachmentExtensions = attachmentAccept.split(",");

const maxSingleUploadBytes = 5 * 1024 ** 3;
const hashChunkBytes = 4 * 1024 ** 2;
const uploadIdleTimeoutMs = 2 * 60 * 1000;

function attachmentPath(communicationId: string) {
  return `/api/communications/${encodeURIComponent(communicationId)}/attachments`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options).catch((failure: unknown) => {
    if (options?.signal?.aborted) throw failure;
    throw new Error("暂时无法连接附件服务，请重试。", { cause: failure });
  });
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return response.json();
  }
  const body = await response.json().catch(() => null);
  throw new CommunicationApiError(
    typeof body?.message === "string"
      ? body.message
      : "附件请求失败，请稍后重试。",
    response.status,
    typeof body?.code === "string" ? body.code : undefined
  );
}

export function listCommunicationAttachments(
  communicationId: string,
  { page, pageSize }: AttachmentPage = {},
  signal?: AbortSignal
) {
  const query = new URLSearchParams();
  if (page !== undefined) query.set("page", String(page));
  if (pageSize !== undefined) query.set("pageSize", String(pageSize));
  const suffix = query.size ? `?${query}` : "";
  return request<AttachmentListResult>(
    `${attachmentPath(communicationId)}${suffix}`,
    { signal }
  );
}

/** 初始化单次上传，也可用原上传 ID 获取待完成的会话。 */
export function initCommunicationAttachment(
  communicationId: string,
  input: AttachmentUploadInput,
  signal?: AbortSignal
) {
  return request<AttachmentUploadSession>(
    `${attachmentPath(communicationId)}/uploads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    }
  );
}

/** 用原上传 ID 完成服务端内容校验并发布附件。 */
export function completeCommunicationAttachment(
  communicationId: string,
  uploadClientId: string,
  signal?: AbortSignal
) {
  return request<{ attachment: Attachment }>(
    `${attachmentPath(communicationId)}/uploads/${encodeURIComponent(uploadClientId)}/complete`,
    { method: "POST", signal }
  );
}

export function downloadCommunicationAttachment(
  communicationId: string,
  attachmentId: string,
  signal?: AbortSignal
) {
  return request<{ downloadUrl: string; expiresAt: string }>(
    `${attachmentPath(communicationId)}/${encodeURIComponent(attachmentId)}/download`,
    { signal }
  );
}

export function deleteCommunicationAttachment(
  communicationId: string,
  attachmentId: string,
  signal?: AbortSignal
) {
  return request<void>(
    `${attachmentPath(communicationId)}/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE", signal }
  );
}

/** 在读取文件内容前检查支持的扩展名和单次直传的大小上限。 */
export function validateAttachmentFile(file: File): void {
  const fileName = file.name.trim().toLowerCase();
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || !attachmentExtensions.includes(fileName.slice(dot))) {
    throw new CommunicationApiError("不支持该附件类型。", 400);
  }
  if (file.size > maxSingleUploadBytes) {
    throw new CommunicationApiError("单个附件不能超过 5 GiB。", 400);
  }
}

export function readAttachmentMimeType(file: Blob) {
  return (
    file.type.split(";", 1)[0]?.trim().toLowerCase() ||
    "application/octet-stream"
  );
}

/**
 * 分块读取文件计算 SHA-256，支持局域网 HTTP 和大文件。
 * @param file 需要计算摘要的文件。
 * @param signal 可选的取消信号。
 * @returns 小写十六进制摘要。
 * @throws 中止操作或无法读取文件时抛出错误。
 */
export async function hashAttachment(file: Blob, signal?: AbortSignal) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += hashChunkBytes) {
    signal?.throwIfAborted();
    const chunk = await file
      .slice(offset, offset + hashChunkBytes)
      .arrayBuffer();
    signal?.throwIfAborted();
    hash.update(new Uint8Array(chunk));
  }
  signal?.throwIfAborted();
  return bytesToHex(hash.digest());
}

/**
 * 使用服务端签发的请求直传整个文件，进度最多显示 99%，直至调用方完成校验。
 * @param upload OSS 短期签名地址及请求头。
 * @param file 已计算摘要的原文件。
 * @param signal 可选的取消信号。
 * @param onProgress 可选的上传百分比回调。
 * @returns OSS 接收请求后完成，收到 409 时由后续完成接口校验已有对象。
 * @throws 请求失败、超时或取消时拒绝。
 */
export async function putAttachment(
  upload: SignedAttachmentUpload,
  file: Blob,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;
    const abort = () => xhr.abort();
    const cleanup = () => {
      clearTimeout(idleTimer);
      signal?.removeEventListener("abort", abort);
    };
    const resetIdleTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        didTimeout = true;
        abort();
      }, uploadIdleTimeoutMs);
    };

    xhr.upload.addEventListener("progress", ({ loaded }) => {
      resetIdleTimeout();
      if (file.size > 0) {
        onProgress?.(Math.min((loaded / file.size) * 100, 99));
      }
    });
    xhr.addEventListener("load", () => {
      const { status } = xhr;
      if ((status >= 200 && status < 300) || status === 409) {
        resolve();
      } else {
        reject(new Error(`附件上传失败（HTTP ${status}），请重试。`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error("无法连接附件服务，请检查网络后重试。"));
    });
    xhr.addEventListener("abort", () => {
      reject(
        didTimeout
          ? new Error("附件上传超时，请检查网络后重试。")
          : (signal?.reason ?? new DOMException("已取消上传。", "AbortError"))
      );
    });
    xhr.addEventListener("loadend", cleanup, { once: true });

    try {
      xhr.open("PUT", upload.url);
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(upload.headers)) {
        if (name.toLowerCase() !== "content-length") {
          xhr.setRequestHeader(name, value);
        }
      }
      signal?.addEventListener("abort", abort, { once: true });
      resetIdleTimeout();
      // 浏览器根据原文件大小发送 Content-Length。
      xhr.send(file);
    } catch {
      cleanup();
      reject(new Error("无法发起附件上传，请重试。"));
    }
  });
}
