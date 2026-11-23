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

type AttachmentPage = { cursor?: string; pageSize?: number };

export type AttachmentListResult = {
  attachments: Attachment[];
  nextCursor: string | null;
  pageSize: number;
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
  expiresAt: string | null;
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

const hashChunkBytes = 4 * 1024 ** 2;
const uploadIdleTimeoutMs = 2 * 60 * 1000;
const attachmentDeletionCheckTimeoutMs = 8_000;

function attachmentPath(communicationId: string) {
  return `/api/communications/${encodeURIComponent(communicationId)}/attachments`;
}

function uploadPath(communicationId: string, uploadClientId: string) {
  return `${attachmentPath(communicationId)}/uploads/${encodeURIComponent(uploadClientId)}`;
}

function attachmentApiError(
  status: number,
  body: { message?: unknown; code?: unknown } | null
) {
  return new CommunicationApiError(
    typeof body?.message === "string"
      ? body.message
      : `附件请求失败（HTTP ${status}），请重试。`,
    status,
    typeof body?.code === "string" ? body.code : undefined
  );
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
  throw attachmentApiError(response.status, body);
}

/** 读取服务端当前存储模式允许的单个附件大小。 */
export async function getCommunicationAttachmentUploadLimit(
  signal?: AbortSignal
) {
  const { maxBytes } = await request<{ maxBytes: number }>(
    "/api/communications/attachment-upload-limit",
    { cache: "no-store", signal }
  );
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("附件大小限制无效。");
  }
  return maxBytes;
}

/**
 * 以游标读取当前沟通的附件，省略游标时从最新一批开始。
 * @param communicationId 当前沟通 ID。
 * @param page 上一批返回的游标及可选的每批条数。
 * @param signal 可选的请求取消信号。
 * @returns 附件元数据及下一批的游标，读到末尾时游标为 null。
 * @throws 请求失败或被取消时拒绝。
 */
export function listCommunicationAttachments(
  communicationId: string,
  page: AttachmentPage = {},
  signal?: AbortSignal
) {
  const { cursor, pageSize } = page;
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (pageSize !== undefined) query.set("pageSize", String(pageSize));
  const suffix = query.size ? `?${query}` : "";
  return request<AttachmentListResult>(
    `${attachmentPath(communicationId)}${suffix}`,
    { cache: "no-store", signal }
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
    `${uploadPath(communicationId, uploadClientId)}/complete`,
    { method: "POST", signal }
  );
}

/** 完成结果不明确时，确认原上传会话是否已经发布。 */
export function readCommunicationAttachmentUpload(
  communicationId: string,
  uploadClientId: string,
  signal?: AbortSignal
) {
  return request<{ state: "pending" | "ready" | "missing" }>(
    uploadPath(communicationId, uploadClientId),
    { cache: "no-store", signal }
  );
}

/** 移除未完成的上传。若附件已发布，返回其状态并保留文件。 */
export function cancelCommunicationAttachmentUpload(
  communicationId: string,
  uploadClientId: string,
  signal?: AbortSignal
) {
  return request<{ state: "ready" | "missing" }>(
    uploadPath(communicationId, uploadClientId),
    { method: "DELETE", signal }
  );
}

export function downloadCommunicationAttachment(
  communicationId: string,
  attachmentId: string,
  signal?: AbortSignal
) {
  return request<{ downloadUrl: string; expiresAt: string | null }>(
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

export type AttachmentDeletionState = "available" | "pending" | "deleted";

/**
 * 删除结果不明确时，读取指定附件的删除状态。
 * @param communicationId 附件所属的沟通记录 ID。
 * @param attachmentId 要核对的附件 ID。
 * @param signal 用户关闭弹窗或离开页面时取消查询的信号。
 * @returns 服务端记录的删除状态。
 * @throws 查询超时、请求失败或没有权限时拒绝。
 */
export async function readCommunicationAttachmentDeletion(
  communicationId: string,
  attachmentId: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const stopCheck = () => controller.abort();
  signal?.addEventListener("abort", stopCheck, { once: true });
  const timeout = setTimeout(stopCheck, attachmentDeletionCheckTimeoutMs);
  try {
    return await request<{ state: AttachmentDeletionState }>(
      `${attachmentPath(communicationId)}/${encodeURIComponent(attachmentId)}`,
      { cache: "no-store", signal: controller.signal }
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stopCheck);
  }
}

/** 在读取文件内容前检查支持的扩展名。 */
export function validateAttachmentFile(file: File): void {
  const fileName = file.name.trim().toLowerCase();
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || !attachmentExtensions.includes(fileName.slice(dot))) {
    throw new CommunicationApiError("不支持该附件类型。", 400);
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
 * @param upload 本地写入地址或 OSS 短期签名地址，以及对应请求头。
 * @param file 已计算摘要的原文件。
 * @param signal 可选的取消信号。
 * @param onProgress 可选的上传百分比回调。
 * @returns 文件接收成功后完成，收到 409 时由后续完成接口校验已有文件。
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
      } else if (upload.url.startsWith("/")) {
        let body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // 代理或服务器拒绝请求时可能返回纯文本。
        }
        reject(attachmentApiError(status, body));
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
