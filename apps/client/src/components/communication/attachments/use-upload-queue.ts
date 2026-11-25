import { useCallback, useEffect, useRef, useState } from "react";

import { createUuid } from "@/lib/uuid";
import {
  CommunicationApiError,
  getCommunication,
} from "@/request/communication";
import {
  cancelCommunicationAttachmentUpload,
  completeCommunicationAttachment,
  hashAttachment,
  initCommunicationAttachment,
  putAttachment,
  readCommunicationAttachmentUpload,
  readAttachmentMimeType,
  validateAttachmentFile,
} from "@/request/communication-attachments";

import type { AttachmentQueueItem } from "./queue";

type UploadItem = AttachmentQueueItem & {
  attachmentId?: string;
  contentSha256?: string;
  initializationSent?: boolean;
};

type CommunicationIssue = "archiving" | "unavailable";

function isAccessError(failure: unknown): failure is CommunicationApiError {
  return (
    failure instanceof CommunicationApiError &&
    [401, 403, 404].includes(failure.status)
  );
}

async function readCommunicationIssue(
  failure: unknown,
  communicationId: string,
  signal: AbortSignal
): Promise<CommunicationIssue | undefined> {
  if (
    failure instanceof CommunicationApiError &&
    failure.code === "archive_in_progress"
  ) {
    return "archiving";
  }
  if (!isAccessError(failure)) return;

  // 单个附件也可能返回 404，只有重新读取父记录才能确认它不可访问。
  try {
    const { communication } = await getCommunication(communicationId, signal);
    if (communication.archiveStartedAt) return "archiving";
  } catch (checkFailure) {
    if (isAccessError(checkFailure)) return "unavailable";
  }
}

function canRetry(failure: unknown) {
  if (!(failure instanceof CommunicationApiError)) return true;
  return (
    failure.status >= 500 ||
    failure.status === 408 ||
    failure.status === 429 ||
    failure.code === "attachment_upload_incomplete"
  );
}

/** 响应丢失或返回暂时错误时，以原上传会话的实际保存状态为准。 */
async function completeUpload(
  communicationId: string,
  id: string,
  signal: AbortSignal
) {
  try {
    await completeCommunicationAttachment(communicationId, id, signal);
  } catch (failure) {
    if (signal.aborted || !canRetry(failure)) throw failure;
    const upload = await readCommunicationAttachmentUpload(
      communicationId,
      id,
      signal
    ).catch((checkFailure: unknown) => {
      if (isAccessError(checkFailure)) throw checkFailure;
      return null;
    });
    if (upload?.state !== "ready") throw failure;
  }
}

/** 持有当前页面的文件草稿，重试时沿用原上传 ID 和已计算的摘要。 */
export function useAttachmentUploadQueue() {
  const itemsRef = useRef<UploadItem[]>([]);
  const active = useRef<AbortController | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [communicationIssue, setCommunicationIssue] =
    useState<CommunicationIssue>();

  useEffect(() => () => active.current?.abort(), []);

  const setQueue = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  function update(id: string, changes: Partial<UploadItem>) {
    setQueue(
      itemsRef.current.map((item) =>
        item.id === id ? { ...item, ...changes } : item
      )
    );
  }

  function add(files: File[]) {
    if (active.current || !files.length) return;
    setQueue([
      ...itemsRef.current,
      ...files.map(
        (file): UploadItem => ({
          id: createUuid(),
          file,
          status: "queued",
        })
      ),
    ]);
  }

  /** 移除本地草稿，或通过原上传 ID 清理后端未完成的文件。 */
  async function remove(id: string, communicationId?: string) {
    if (active.current) return;
    const item = itemsRef.current.find((file) => file.id === id);
    if (!item || !["queued", "failed", "remove-failed"].includes(item.status))
      return;
    if (!item.initializationSent || !communicationId) {
      setQueue(itemsRef.current.filter((file) => file.id !== id));
      return "removed" as const;
    }

    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true);
    update(id, { status: "removing", error: undefined, progress: undefined });
    try {
      const upload = await cancelCommunicationAttachmentUpload(
        communicationId,
        id,
        signal
      );
      signal.throwIfAborted();
      if (upload.state === "ready") {
        update(id, { status: "succeeded" });
        return "ready" as const;
      }
      setQueue(itemsRef.current.filter((file) => file.id !== id));
      return "removed" as const;
    } catch (failure) {
      if (signal.aborted) return;
      const issue = await readCommunicationIssue(
        failure,
        communicationId,
        signal
      );
      if (signal.aborted) return;
      if (issue) setCommunicationIssue(issue);
      update(id, {
        status: "remove-failed",
        error:
          failure instanceof Error ? failure.message : "移除附件失败，请重试。",
      });
    } finally {
      active.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  /** 新文件逐个提交。单个失败会留在队列，其余文件继续上传。 */
  async function upload(communicationId: string, retryId?: string) {
    if (active.current) return false;
    const selected = itemsRef.current.filter((item) =>
      retryId
        ? item.id === retryId && item.status === "failed" && item.retryable
        : item.status === "queued"
    );
    if (!selected.length) return true;

    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true);
    let succeeded = true;
    try {
      for (const item of selected) {
        if (signal.aborted) return false;
        const { id, file } = item;
        try {
          update(id, {
            status: "preparing",
            error: undefined,
            progress: undefined,
          });
          validateAttachmentFile(file);
          const mimeType = readAttachmentMimeType(file);
          const contentSha256 =
            item.contentSha256 ?? (await hashAttachment(file, signal));
          signal.throwIfAborted();
          update(id, { contentSha256, initializationSent: true });
          const { attachmentId, upload: request } =
            await initCommunicationAttachment(
              communicationId,
              {
                fileName: file.name,
                fileSize: file.size,
                mimeType,
                contentSha256,
                uploadClientId: id,
              },
              signal
            );
          signal.throwIfAborted();
          update(id, { attachmentId });
          if (request) {
            update(id, { status: "uploading", progress: 0 });
            await putAttachment(request, file, signal, (progress) => {
              if (!signal.aborted) update(id, { progress });
            });
          }
          signal.throwIfAborted();
          update(id, { status: "completing" });
          await completeUpload(communicationId, id, signal);
          signal.throwIfAborted();
          update(id, { status: "succeeded" });
        } catch (failure) {
          if (signal.aborted) return false;
          const issue = await readCommunicationIssue(
            failure,
            communicationId,
            signal
          );
          if (signal.aborted) return false;
          succeeded = false;
          update(id, {
            status: "failed",
            retryable: canRetry(failure),
            error:
              failure instanceof Error ? failure.message : "上传失败，请重试。",
          });
          if (issue) {
            setCommunicationIssue(issue);
            return false;
          }
        }
      }
      return succeeded;
    } finally {
      active.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  /** 列表读到了对应的正式附件时，将等待核对的失败任务标记为成功。 */
  const reconcileCompleted = useCallback(
    (listedIds: ReadonlySet<string>) => {
      const previous = itemsRef.current;
      const next = previous.map(
        (item): UploadItem =>
          (item.status === "failed" || item.status === "remove-failed") &&
          item.attachmentId &&
          listedIds.has(item.attachmentId)
            ? {
                ...item,
                status: "succeeded",
                error: undefined,
                retryable: false,
              }
            : item
      );
      if (next.every((item, index) => item === previous[index])) return false;
      setQueue(next);
      return true;
    },
    [setQueue]
  );

  function clearCompleted() {
    if (active.current) return;
    setQueue(itemsRef.current.filter((item) => item.status !== "succeeded"));
  }

  return {
    items,
    busy,
    communicationIssue,
    add,
    remove,
    upload,
    clearCompleted,
    reconcileCompleted,
  };
}

export type AttachmentUploadQueue = ReturnType<typeof useAttachmentUploadQueue>;
