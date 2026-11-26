import { HTTPException } from "hono/http-exception";

import type { Database } from "../../identity/auth/better-auth";
import {
  claimAttachmentCleanupBatch,
  closePendingLocalUpload,
  deferClaimedAttachmentCleanup,
  markAttachmentObjectDeleted,
  readArchivedAttachmentToClean,
  readAttachmentObjectDeletedAt,
  registerLateAttachmentWrite,
} from "../persistence/attachments";
import type { Attachment } from "../persistence/attachments";
import type {
  AttachmentStorage,
  GetAttachmentStorage,
} from "../storage/object-store";
import { attachmentError, useStorage } from "./errors";

const cleanupTimerMs = 15 * 60 * 1000;
const cleanupRuntime = globalThis as typeof globalThis & {
  communicationAttachmentCleanupTimer?: ReturnType<typeof setInterval>;
  wakeCommunicationAttachmentCleanup?: () => void;
};

export function createAttachmentCleanup(
  db: Database,
  getStorage: GetAttachmentStorage
) {
  async function cleanupArchived(row: Attachment, storage: AttachmentStorage) {
    await useStorage(async () => {
      try {
        await storage.removeSingleUpload(row.storageKey);
      } finally {
        await storage.remove(row.storageKey);
      }
    });
    return markAttachmentObjectDeleted(db, row);
  }

  /** 用户收到成功前，确认当前清理代次已经完成。 */
  async function confirmAttachmentCleanup(row: Attachment) {
    let cleanupError: HTTPException | undefined;
    try {
      if (await cleanupArchived(row, await useStorage(getStorage))) return;
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 503)
        throw error;
      cleanupError = error;
    }

    if (await readAttachmentObjectDeletedAt(db, row.id)) return;
    if (cleanupError) throw cleanupError;
    return attachmentError(
      503,
      "attachment_storage_unavailable",
      "附件仍在清理，请稍后重试。"
    );
  }

  const archiveCleanupBudgetMs = 2_000;

  async function cleanupCommunicationAttachments(attachments: Attachment[]) {
    const storage = await useStorage(getStorage);
    const deadline = performance.now() + archiveCleanupBudgetMs;
    for (const row of attachments) {
      // 已开始的存储操作完成后，再决定是否处理下一件。
      if (performance.now() >= deadline) break;
      await cleanupArchived(row, storage);
    }
  }

  /**
   * 续做附件删除，回收过期的本地上传，并复查归档前已发上传地址留下的临时文件。
   * @returns 本批回收结束，单条清理失败时保留记录供下次重试。
   * @throws 存储配置无效或数据库查询失败时抛出异常。
   */
  async function cleanupExpiredAttachmentUploads() {
    const storage = await useStorage(getStorage);
    const expired = await db.transaction((tx) =>
      claimAttachmentCleanupBatch(tx, storage.kind === "local")
    );

    for (const row of expired) {
      try {
        await cleanupArchived(row, storage);
      } catch {
        console.warn("回收过期的沟通附件上传失败，下次将重试。", row.id);
        await deferAttachmentCleanup(row);
      }
    }
  }

  async function deferAttachmentCleanup(row: Attachment) {
    if (!row.cleanupNextAttemptAt) return;
    const failureCount = Math.min(row.cleanupFailureCount + 1, 5);
    const retryMinutes = Math.min(30 * 2 ** (failureCount - 1), 360);
    await deferClaimedAttachmentCleanup(
      db,
      row,
      row.cleanupNextAttemptAt,
      failureCount,
      retryMinutes
    );
  }

  function requestAttachmentUploadCleanup() {
    cleanupRuntime.wakeCommunicationAttachmentCleanup?.();
  }

  /** 启动附件过期回收，服务启动时立即执行，之后每 15 分钟一次。 */
  function startAttachmentUploadCleanup() {
    clearInterval(cleanupRuntime.communicationAttachmentCleanupTimer);
    cleanupRuntime.wakeCommunicationAttachmentCleanup = undefined;
    const kind = process.env.COMMUNICATION_ATTACHMENT_STORAGE?.trim() || "oss";
    if (kind !== "local" && kind !== "oss") return;
    if (kind === "oss" && !process.env.OSS_BUCKET?.trim()) return;

    let running = false;
    let wakeRequested = false;
    async function runCleanup() {
      if (running) return;
      running = true;
      try {
        do {
          wakeRequested = false;
          try {
            await cleanupExpiredAttachmentUploads();
          } catch {
            console.warn("无法执行沟通附件上传过期回收，下次将重试。");
          }
        } while (wakeRequested);
      } finally {
        running = false;
      }
    }

    cleanupRuntime.wakeCommunicationAttachmentCleanup = () => {
      wakeRequested = true;
      void runCleanup();
    };
    void runCleanup();
    cleanupRuntime.communicationAttachmentCleanupTimer = setInterval(
      runCleanup,
      cleanupTimerMs
    ).unref();
  }

  async function cleanupArchivedUpload(
    row: Attachment,
    storage: AttachmentStorage,
    mayHaveWritten: boolean
  ) {
    // 已发出的写入可能在删除之后落盘，先登记补偿，再访问存储。
    const archived = mayHaveWritten
      ? await registerLateAttachmentWrite(db, row.id)
      : await readArchivedAttachmentToClean(db, row.id);
    if (archived) await cleanupArchived(archived, storage);
  }

  /** 回收权限变化前已接收的文件，只归档仍未完成的上传。 */
  async function cleanupPendingLocalUpload(
    row: Attachment,
    storage: AttachmentStorage,
    mayHaveWritten: boolean
  ) {
    await closePendingLocalUpload(db, row);
    await cleanupArchivedUpload(row, storage, mayHaveWritten);
  }

  return {
    cleanupArchivedUpload,
    cleanupCommunicationAttachments,
    cleanupExpiredAttachmentUploads,
    cleanupPendingLocalUpload,
    confirmAttachmentCleanup,
    requestAttachmentUploadCleanup,
    startAttachmentUploadCleanup,
  };
}

export type AttachmentCleanup = ReturnType<typeof createAttachmentCleanup>;
