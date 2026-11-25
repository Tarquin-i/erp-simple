import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

import { AttachmentQueue } from "./queue";
import type { AttachmentUploadQueue } from "./use-upload-queue";

/** 显示沟通保存之后的附件处理状态。 */
export function SavedAttachmentUploadStatus({
  queue,
}: {
  queue: AttachmentUploadQueue;
}) {
  const isRemoving = queue.items.some((item) => item.status === "removing");
  const hasRemoveFailure = queue.items.some(
    (item) => item.status === "remove-failed"
  );
  const failed = queue.items.filter((item) => item.status === "failed");
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {isRemoving
        ? "正在移除附件，请稍候。"
        : queue.busy
          ? "正在上传附件，请稍候。"
          : hasRemoveFailure
            ? "有附件移除失败，可以重试。"
            : failed.length
              ? failed.some((item) => item.retryable)
                ? "部分附件未上传，你可以重试或移除这些文件。"
                : "部分附件未上传，你可以移除这些文件。"
              : "可以前往沟通详情查看附件。"}
    </p>
  );
}

/** 沟通保存后单独处理文件。附件重试只提交文件，同一条沟通资料保持已保存。 */
export function SavedAttachmentUploads({
  communicationId,
  queue,
  recordSaved,
  error,
  onView,
  onUnavailable,
}: {
  communicationId: string;
  queue: AttachmentUploadQueue;
  recordSaved: boolean;
  error?: string;
  onView: () => void;
  onUnavailable: () => void;
}) {
  const issue = queue.communicationIssue;
  const archiving = issue === "archiving";
  const unavailable = issue === "unavailable";
  const title = archiving
    ? "沟通记录正在归档"
    : unavailable
      ? "无法查看此沟通记录"
      : recordSaved
        ? "沟通记录已保存"
        : "沟通附件";
  return (
    <main className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {issue ? (
            <FieldError>
              {archiving
                ? "归档期间无法上传或移除附件，尚未上传的文件仍保留在当前页面。"
                : "此沟通记录已不可访问，无法继续处理附件。"}
            </FieldError>
          ) : (
            <SavedAttachmentUploadStatus queue={queue} />
          )}
        </div>
        <Button
          type="button"
          disabled={queue.busy}
          onClick={unavailable ? onUnavailable : onView}
        >
          {unavailable
            ? "返回沟通列表"
            : archiving
              ? "返回沟通详情"
              : "查看沟通详情"}
        </Button>
      </header>
      {!issue && error && <FieldError>{error}</FieldError>}
      <AttachmentQueue
        items={
          issue
            ? queue.items.map((item) => ({ ...item, error: undefined }))
            : queue.items
        }
        disabled={queue.busy}
        onRetry={
          issue ? undefined : (id) => void queue.upload(communicationId, id)
        }
        onRemove={
          issue ? undefined : (id) => void queue.remove(id, communicationId)
        }
      />
    </main>
  );
}
