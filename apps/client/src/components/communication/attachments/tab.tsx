import { useEffect, useRef, useState } from "react";

import { CustomerPagination } from "@/components/customers/pagination";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { CommunicationApiError } from "@/request/communication";
import {
  attachmentAccept,
  deleteCommunicationAttachment,
  downloadCommunicationAttachment,
  listCommunicationAttachments,
} from "@/request/communication-attachments";
import type {
  Attachment,
  AttachmentListResult,
} from "@/request/communication-attachments";

import { AttachmentDropZone } from "./drop-zone";
import { AttachmentQueue } from "./queue";
import { AttachmentTable } from "./table";
import { useAttachmentUploadQueue } from "./use-upload-queue";

function errorMessage(failure: unknown, fallback: string) {
  return failure instanceof Error ? failure.message : fallback;
}

function startDownload(url: string, onFailure: () => void) {
  // 文件交给浏览器原生下载。OSS 拒绝签名时，错误页留在隐藏框内。
  const frame = document.createElement("iframe");
  const timer = setTimeout(() => frame.remove(), 5 * 60_000);
  frame.hidden = true;
  frame.referrerPolicy = "no-referrer";
  frame.addEventListener(
    "load",
    () => {
      clearTimeout(timer);
      frame.remove();
      onFailure();
    },
    { once: true }
  );
  frame.src = url;
  document.body.append(frame);
}

/** 查看、直传、下载和删除当前沟通的附件。 */
export function CommunicationAttachmentsTab({
  communicationId,
}: {
  communicationId: string;
}) {
  const uploads = useAttachmentUploadQueue();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<AttachmentListResult>();
  const [listError, setListError] = useState<Error>();
  const [downloadError, setDownloadError] = useState<{
    attachment: Attachment;
    message: string;
  }>();
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [deleteTarget, setDeleteTarget] = useState<Attachment>();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const downloadRequests = useRef(new Map<string, AbortController>());
  const deleteRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const requests = downloadRequests.current;
    return () => {
      mounted.current = false;
      for (const request of requests.values()) request.abort();
      deleteRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setListError(undefined);
    void listCommunicationAttachments(
      communicationId,
      { page },
      controller.signal
    ).then(
      (next) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize));
        if (page > lastPage) setPage(lastPage);
        else setResult(next);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setListError(
            failure instanceof Error
              ? failure
              : new Error("暂时无法加载沟通附件。")
          );
        }
      }
    );
    return () => controller.abort();
  }, [communicationId, page, revision]);

  function refresh() {
    setRevision((previous) => previous + 1);
  }

  async function upload(retryId?: string) {
    await uploads.upload(communicationId, retryId);
    if (!mounted.current) return;
    uploads.clearCompleted();
    setPage(1);
    refresh();
  }

  async function download(attachment: Attachment) {
    const requests = downloadRequests.current;
    if (requests.has(attachment.id)) return;
    setDownloadError(undefined);
    const controller = new AbortController();
    requests.set(attachment.id, controller);
    setDownloading(new Set(requests.keys()));
    try {
      const { downloadUrl } = await downloadCommunicationAttachment(
        communicationId,
        attachment.id,
        controller.signal
      );
      if (controller.signal.aborted) return;
      startDownload(downloadUrl, () => {
        if (mounted.current)
          setDownloadError({
            attachment,
            message: "下载未开始，请重新获取下载链接。",
          });
      });
    } catch (failure) {
      if (!controller.signal.aborted) {
        setDownloadError({
          attachment,
          message: errorMessage(failure, "下载失败，请重试。"),
        });
      }
    } finally {
      requests.delete(attachment.id);
      if (!controller.signal.aborted) setDownloading(new Set(requests.keys()));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteRequest.current) return;
    const controller = new AbortController();
    deleteRequest.current = controller;
    setDeleteError("");
    setDeletePending(true);
    try {
      await deleteCommunicationAttachment(
        communicationId,
        deleteTarget.id,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setDeleteTarget(undefined);
      setResult(
        (previous) =>
          previous && {
            ...previous,
            attachments: previous.attachments.filter(
              ({ id }) => id !== deleteTarget.id
            ),
          }
      );
      setDownloadError((previous) =>
        previous?.attachment.id === deleteTarget.id ? undefined : previous
      );
    } catch (failure) {
      if (!controller.signal.aborted)
        setDeleteError(errorMessage(failure, "删除失败，请重试。"));
    } finally {
      deleteRequest.current = null;
      if (!controller.signal.aborted) {
        setDeletePending(false);
        // 文件可能已归档或删除，只是清理失败或响应未返回。
        refresh();
      }
    }
  }

  const inaccessible =
    listError instanceof CommunicationApiError &&
    [401, 403, 404].includes(listError.status);
  const pageCount = Math.max(
    1,
    Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 20))
  );

  return (
    <div className="min-w-0 space-y-4">
      <AttachmentDropZone
        accept={attachmentAccept}
        disabled={uploads.busy || deletePending || inaccessible}
        onFilesSelected={(files) => {
          uploads.add(files);
          void upload();
        }}
      />
      <AttachmentQueue
        items={uploads.items}
        disabled={uploads.busy || inaccessible}
        onRetry={(id) => void upload(id)}
        onRemove={uploads.remove}
      />
      {downloadError && (
        <div className="flex flex-wrap items-center gap-2">
          <FieldError>{downloadError.message}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              inaccessible || downloading.has(downloadError.attachment.id)
            }
            onClick={() => void download(downloadError.attachment)}
          >
            重试下载
          </Button>
        </div>
      )}
      {listError && (
        <div className="flex flex-wrap items-center gap-2">
          <FieldError>{listError.message}</FieldError>
          {!inaccessible && (
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              重试加载
            </Button>
          )}
        </div>
      )}
      {!inaccessible && result?.page === page ? (
        <>
          <AttachmentTable
            attachments={result.attachments}
            downloadingIds={downloading}
            deletingId={deletePending ? deleteTarget?.id : undefined}
            onDownload={(attachment) => void download(attachment)}
            onDelete={(attachment) => {
              setDeleteError("");
              setDeleteTarget(attachment);
            }}
          />
          {pageCount > 1 && (
            <CustomerPagination
              label="附件分页"
              page={page}
              pageCount={pageCount}
              total={result.total}
              onPageChange={setPage}
            />
          )}
        </>
      ) : (
        !listError && (
          <Skeleton
            className="h-32"
            aria-busy="true"
            aria-label="正在加载沟通附件"
          />
        )
      )}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next && !deleteRequest.current) setDeleteTarget(undefined);
        }}
      >
        {deleteTarget && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除附件？</AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                确认删除「{deleteTarget.fileName}」？
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError && <FieldError>{deleteError}</FieldError>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>
                取消
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={deletePending}
                aria-busy={deletePending}
                onClick={() => void confirmDelete()}
              >
                {deletePending
                  ? "正在删除…"
                  : deleteError
                    ? "重试删除"
                    : "确认删除"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
