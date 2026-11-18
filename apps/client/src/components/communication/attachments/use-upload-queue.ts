import { useEffect, useRef, useState } from "react";

import { createUuid } from "@/lib/uuid";
import { CommunicationApiError } from "@/request/communication";
import {
  completeCommunicationAttachment,
  hashAttachment,
  initCommunicationAttachment,
  putAttachment,
  readAttachmentMimeType,
  validateAttachmentFile,
} from "@/request/communication-attachments";

import type { AttachmentQueueItem } from "./queue";

type UploadItem = AttachmentQueueItem & { contentSha256?: string };

function canRetry(failure: unknown) {
  if (!(failure instanceof CommunicationApiError)) return true;
  return (
    failure.status >= 500 ||
    failure.status === 408 ||
    failure.status === 429 ||
    failure.code === "attachment_upload_incomplete"
  );
}

/** 持有当前页面的文件草稿，重试时沿用原上传 ID 和已计算的摘要。 */
export function useAttachmentUploadQueue() {
  const itemsRef = useRef<UploadItem[]>([]);
  const active = useRef<AbortController | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => active.current?.abort(), []);

  function setQueue(next: UploadItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

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

  function remove(id: string) {
    if (active.current) return;
    setQueue(itemsRef.current.filter((item) => item.id !== id));
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
          update(id, { contentSha256 });
          const { upload: request } = await initCommunicationAttachment(
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
          if (request) {
            update(id, { status: "uploading", progress: 0 });
            await putAttachment(request, file, signal, (progress) => {
              if (!signal.aborted) update(id, { progress });
            });
          }
          signal.throwIfAborted();
          update(id, { status: "completing" });
          await completeCommunicationAttachment(communicationId, id, signal);
          signal.throwIfAborted();
          update(id, { status: "succeeded" });
        } catch (failure) {
          if (signal.aborted) return false;
          succeeded = false;
          update(id, {
            status: "failed",
            retryable: canRetry(failure),
            error:
              failure instanceof Error ? failure.message : "上传失败，请重试。",
          });
        }
      }
      return succeeded;
    } finally {
      active.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  function clearCompleted() {
    setQueue(itemsRef.current.filter((item) => item.status !== "succeeded"));
  }

  return { items, busy, add, remove, upload, clearCompleted };
}

export type AttachmentUploadQueue = ReturnType<typeof useAttachmentUploadQueue>;
