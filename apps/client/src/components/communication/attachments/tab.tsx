import { ListChecks, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CommunicationApiError } from "@/request/communication";
import {
  attachmentAccept,
  deleteCommunicationAttachment,
  downloadCommunicationAttachment,
  listCommunicationAttachments,
  readCommunicationAttachmentDeletion,
} from "@/request/communication-attachments";
import type {
  Attachment,
  AttachmentDeletionState,
  AttachmentListResult,
} from "@/request/communication-attachments";

import { AttachmentDropZone, attachmentEncodingHint } from "./drop-zone";
import { AttachmentQueue } from "./queue";
import { AttachmentTimeline } from "./timeline";
import { useAttachmentUploadQueue } from "./use-upload-queue";

type AttachmentListRequest = {
  page: number;
  cursor?: string;
  replacePages?: boolean;
};

type LoadedAttachments = AttachmentListResult & { page: number };

type AttachmentDeleteRequest = {
  controller: AbortController;
  loadedPage: number;
  phase: "deleting" | "checking";
};

/**
 * 读取下一批附件，或从开头逐批重读已展开的范围。
 * @param communicationId 当前沟通 ID。
 * @param request 目标页码及是否替换已加载的页面。
 * @param signal 切换请求或离开页面时使用的取消信号。
 * @returns 当前页信息及请求范围内按 ID 去重的附件。
 * @throws 读取失败或请求被取消时拒绝。
 */
async function loadAttachments(
  communicationId: string,
  request: AttachmentListRequest,
  signal: AbortSignal
): Promise<LoadedAttachments> {
  const { page, cursor, replacePages } = request;
  if (!replacePages || page === 1) {
    const result = await listCommunicationAttachments(
      communicationId,
      { cursor },
      signal
    );
    return { ...result, page };
  }

  // 刷新时重建整段游标链，同时替换已展开的页面。
  let loadedPage = 1;
  let result = await listCommunicationAttachments(communicationId, {}, signal);
  const attachments = new Map(
    result.attachments.map((item) => [item.id, item])
  );
  while (loadedPage < page && result.nextCursor) {
    result = await listCommunicationAttachments(
      communicationId,
      { cursor: result.nextCursor },
      signal
    );
    loadedPage += 1;
    for (const item of result.attachments) attachments.set(item.id, item);
  }
  return {
    ...result,
    page: loadedPage,
    attachments: [...attachments.values()],
  };
}

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
  actionsSlot,
}: {
  communicationId: string;
  actionsSlot: HTMLDivElement | null;
}) {
  const uploads = useAttachmentUploadQueue();
  const { reconcileCompleted } = uploads;
  const [listRequest, setListRequest] = useState<AttachmentListRequest>({
    page: 1,
  });
  const [result, setResult] = useState<LoadedAttachments>();
  const [listError, setListError] = useState<Error>();
  const [listPending, setListPending] = useState(true);
  const [downloadError, setDownloadError] = useState<{
    attachment: Attachment;
    message: string;
  }>();
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [deleteTarget, setDeleteTarget] = useState<Attachment>();
  const [deleteProgress, setDeleteProgress] =
    useState<AttachmentDeleteRequest["phase"]>();
  const deletePending = deleteProgress !== undefined;
  const [deleteError, setDeleteError] = useState("");
  const [uploadStatusOpen, setUploadStatusOpen] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const downloadRequests = useRef(new Map<string, AbortController>());
  const deleteRequest = useRef<AttachmentDeleteRequest | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const requests = downloadRequests.current;
    return () => {
      mounted.current = false;
      for (const request of requests.values()) request.abort();
      deleteRequest.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setListPending(true);
    setListError(undefined);
    void loadAttachments(communicationId, listRequest, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setListPending(false);
        const readyIds = new Set(
          next.attachments
            .filter((item) => !item.deletionPending)
            .map(({ id }) => id)
        );
        if (reconcileCompleted(readyIds)) setUploadMessage("附件上传成功。");
        setResult((previous) => {
          if (listRequest.replacePages || next.page === 1 || !previous) {
            return next;
          }
          const attachments = new Map(
            previous.attachments.map((item) => [item.id, item])
          );
          for (const item of next.attachments) attachments.set(item.id, item);
          return { ...next, attachments: [...attachments.values()] };
        });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setListPending(false);
          setListError(
            failure instanceof Error
              ? failure
              : new Error("暂时无法加载沟通附件。")
          );
        }
      }
    );
    return () => controller.abort();
  }, [communicationId, listRequest, reconcileCompleted]);

  const loadedPage = result?.page;
  useEffect(() => {
    if (
      !loadedPage ||
      listPending ||
      listError ||
      uploads.busy ||
      deletePending
    ) {
      return;
    }

    const refreshVisibleList = () => {
      if (document.visibilityState !== "visible" || deleteRequest.current) {
        return;
      }
      setListPending(true);
      setListRequest(({ page }) => ({
        page: Math.max(page, loadedPage),
        replacePages: true,
      }));
    };

    // 回到此标签页时才核对已展示的附件，保留原来的展开范围。
    document.addEventListener("visibilitychange", refreshVisibleList);
    return () =>
      document.removeEventListener("visibilitychange", refreshVisibleList);
  }, [deletePending, listError, listPending, loadedPage, uploads.busy]);

  function refresh() {
    setListRequest((previous) => ({ ...previous }));
  }

  function reload() {
    setListRequest({ page: 1 });
  }

  async function upload(retryId?: string) {
    setUploadMessage("");
    const succeeded = await uploads.upload(communicationId, retryId);
    if (!mounted.current) return;
    if (succeeded) setUploadMessage("附件上传成功。");
    reload();
  }

  async function removeUpload(id: string) {
    setUploadMessage("");
    const result = await uploads.remove(id, communicationId);
    if (!mounted.current || !result) return;
    if (result === "ready") {
      setUploadMessage("附件已上传成功，已保留。");
    }
    reload();
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

  function refreshAfterDelete(loadedPage: number) {
    setListPending(true);
    setListRequest(({ page }) => ({
      page: Math.max(page, loadedPage),
      replacePages: true,
    }));
  }

  function closeDeleteDialog() {
    const request = deleteRequest.current;
    if (request?.phase === "deleting") return;
    if (request) {
      // 先结束本次核对，再取消等待，避免迟到的结果干扰下一次删除。
      deleteRequest.current = null;
      request.controller.abort();
      setDeleteProgress(undefined);
      refreshAfterDelete(request.loadedPage);
    }
    setDeleteTarget(undefined);
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteRequest.current) return;
    const controller = new AbortController();
    const request: AttachmentDeleteRequest = {
      controller,
      loadedPage: result?.page ?? 1,
      phase: "deleting",
    };
    deleteRequest.current = request;
    setDeleteError("");
    setDeleteProgress("deleting");
    try {
      let state: AttachmentDeletionState | undefined = "deleted";
      let message = "";
      try {
        await deleteCommunicationAttachment(
          communicationId,
          deleteTarget.id,
          controller.signal
        );
      } catch (failure) {
        if (controller.signal.aborted) return;
        const apiError =
          failure instanceof CommunicationApiError ? failure : undefined;
        const storageFailed =
          apiError?.code === "attachment_storage_unavailable";
        state = storageFailed ? "pending" : undefined;
        message = errorMessage(failure, "删除失败，请重试。");

        // 网络断开或服务器错误可能发生在实际删除完成之后，按附件 ID 核对。
        if (!apiError || apiError.status >= 500) {
          request.phase = "checking";
          setDeleteProgress("checking");
          try {
            const checked = await readCommunicationAttachmentDeletion(
              communicationId,
              deleteTarget.id,
              controller.signal
            );
            state = checked.state;
            if (state === "pending" && !storageFailed) {
              message = "附件尚未完成删除，请重试。";
            }
          } catch {
            if (!storageFailed)
              message = "暂时无法确认附件是否已删除，请重试。";
          }
        }
      }
      if (controller.signal.aborted || deleteRequest.current !== request)
        return;

      if (state === "deleted") {
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
      } else {
        setDeleteError(message);
      }
      if (state === "pending") {
        setResult((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            attachments: previous.attachments.map((item) =>
              item.id === deleteTarget.id
                ? { ...item, deletionPending: true }
                : item
            ),
          };
        });
      }
      if (state === "pending" || state === "deleted") {
        setDownloadError((previous) =>
          previous?.attachment.id === deleteTarget.id ? undefined : previous
        );
      }
    } finally {
      if (deleteRequest.current === request) {
        deleteRequest.current = null;
        if (!controller.signal.aborted) {
          setDeleteProgress(undefined);
          // 文件可能已归档或删除，只是清理失败或响应未返回。
          refreshAfterDelete(request.loadedPage);
        }
      }
    }
  }

  const inaccessible =
    listError instanceof CommunicationApiError &&
    [401, 403, 404].includes(listError.status);
  const loadingMore = Boolean(listRequest.cursor && listPending);
  const nextCursor = result?.nextCursor;
  const uploadDisabled =
    uploads.busy || deletePending || inaccessible || !result;
  const hasCompletedUploads = uploads.items.some(
    (item) => item.status === "succeeded"
  );

  return (
    <Dialog open={uploadStatusOpen} onOpenChange={setUploadStatusOpen}>
      <AttachmentDropZone
        accept={attachmentAccept}
        disabled={uploadDisabled || uploadStatusOpen || Boolean(deleteTarget)}
        onFilesSelected={(files) => {
          uploads.add(files);
          setUploadStatusOpen(true);
          void upload();
        }}
      >
        {({ selectFiles, selectionDisabled, dropButton }) => (
          <>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={refresh}
                  >
                    重试加载
                  </Button>
                )}
              </div>
            )}
            {!inaccessible && result ? (
              <>
                <AttachmentTimeline
                  actionsSlot={actionsSlot}
                  attachments={result.attachments}
                  communicationId={communicationId}
                  downloadingIds={downloading}
                  downloadError={
                    downloadError && {
                      attachmentId: downloadError.attachment.id,
                      message: downloadError.message,
                    }
                  }
                  deletingId={deletePending ? deleteTarget?.id : undefined}
                  onDownload={(attachment) => void download(attachment)}
                  onDelete={(attachment) => {
                    setDeleteError("");
                    setDeleteTarget(attachment);
                  }}
                  fileActions={
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="上传附件"
                            disabled={selectionDisabled}
                            onClick={selectFiles}
                          >
                            <Upload aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          上传附件 · {attachmentEncodingHint}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="查看上传状态"
                            >
                              <ListChecks aria-hidden="true" />
                            </Button>
                          </DialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>查看上传状态</TooltipContent>
                      </Tooltip>
                    </>
                  }
                  empty={
                    <div className="space-y-2">
                      <span className="sr-only">暂无附件</span>
                      {dropButton}
                    </div>
                  }
                />
                {nextCursor && (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-busy={loadingMore}
                      disabled={listPending || Boolean(listError)}
                      onClick={() =>
                        setListRequest({
                          page: result.page + 1,
                          cursor: nextCursor,
                        })
                      }
                    >
                      {loadingMore && (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      )}
                      {loadingMore ? "加载中…" : "加载更多"}
                    </Button>
                  </div>
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
          </>
        )}
      </AttachmentDropZone>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader className="pr-7">
          <DialogTitle>附件上传状态</DialogTitle>
          <DialogDescription className="sr-only">
            查看本页附件上传的进度和结果。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto">
          {uploadMessage && (
            <p className="text-sm text-muted-foreground" role="status">
              {uploadMessage}
            </p>
          )}
          {uploads.items.length > 0 ? (
            <AttachmentQueue
              items={uploads.items}
              disabled={uploads.busy || inaccessible || deletePending}
              onRetry={(id) => void upload(id)}
              onRemove={(id) => void removeUpload(id)}
              label="附件上传任务"
            />
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无上传任务
            </p>
          )}
        </div>
        {hasCompletedUploads && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploads.busy}
              onClick={() => {
                uploads.clearCompleted();
                setUploadMessage("");
              }}
            >
              清除已完成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) closeDeleteDialog();
        }}
      >
        {deleteTarget && (
          <AlertDialogContent className="w-[calc(100%-2rem)]">
            <AlertDialogHeader>
              <AlertDialogTitle>删除附件？</AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                {deleteProgress === "checking"
                  ? `正在核对「${deleteTarget.fileName}」的删除结果。关闭后会刷新附件列表。`
                  : `确认删除「${deleteTarget.fileName}」？`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError && <FieldError>{deleteError}</FieldError>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteProgress === "deleting"}>
                取消
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={deletePending}
                aria-busy={deletePending}
                onClick={() => void confirmDelete()}
              >
                {deleteProgress === "checking"
                  ? "正在核对附件状态…"
                  : deleteProgress === "deleting"
                    ? "正在删除…"
                    : deleteError
                      ? "重试删除"
                      : "确认删除"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Dialog>
  );
}
