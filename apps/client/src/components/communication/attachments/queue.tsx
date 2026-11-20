import { Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

import { formatFileSize } from "./file-size";

type AttachmentQueueStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "completing"
  | "succeeded"
  | "failed"
  | "removing"
  | "remove-failed";

export type AttachmentQueueItem = {
  id: string;
  file: File;
  status: AttachmentQueueStatus;
  progress?: number;
  error?: string;
  retryable?: boolean;
};

type AttachmentQueueProps = {
  items: readonly AttachmentQueueItem[];
  label?: string;
  disabled?: boolean;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
};

const statusLabels: Record<AttachmentQueueStatus, string> = {
  queued: "待上传",
  preparing: "正在准备",
  uploading: "上传中",
  completing: "正在确认",
  succeeded: "已上传",
  failed: "上传失败",
  removing: "正在移除",
  "remove-failed": "移除失败",
};

/** 显示队列状态、上传进度和可用的操作。 */
export function AttachmentQueue({
  items,
  label = "待上传附件",
  disabled = false,
  onRetry,
  onRemove,
}: AttachmentQueueProps) {
  if (!items.length) return null;

  return (
    <ul aria-label={label} className="divide-y rounded-lg border">
      {items.map(({ id, file, status, progress, error, retryable }) => {
        const uploadProgress =
          progress === undefined
            ? undefined
            : Math.min(100, Math.max(0, Math.round(progress)));
        const canRetry = onRetry && status === "failed" && retryable !== false;
        const canRemove =
          onRemove &&
          (status === "queued" ||
            status === "failed" ||
            status === "remove-failed");
        const removeLabel = status === "remove-failed" ? "重试移除" : "移除";
        return (
          <li key={id} className="space-y-1 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Paperclip
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-sm font-medium wrap-anywhere">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
                <Badge
                  role="status"
                  variant={
                    status === "failed" || status === "remove-failed"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {statusLabels[status]}
                </Badge>
              </div>
              {(canRetry || canRemove) && (
                <div className="flex shrink-0 items-center gap-1">
                  {canRetry && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`重试上传 ${file.name}`}
                      disabled={disabled}
                      onClick={() => onRetry(id)}
                    >
                      重试
                    </Button>
                  )}
                  {canRemove && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${removeLabel} ${file.name}`}
                      disabled={disabled}
                      onClick={() => onRemove(id)}
                    >
                      {removeLabel}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {status === "uploading" && (
              <div className="ml-7 flex items-center gap-2">
                <progress
                  aria-label={`${file.name} 的上传进度`}
                  className="h-1.5 w-full accent-primary"
                  max={100}
                  value={uploadProgress}
                />
                {uploadProgress !== undefined && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {uploadProgress}%
                  </span>
                )}
              </div>
            )}
            {error && (
              <FieldError className="ml-7 wrap-anywhere">{error}</FieldError>
            )}
          </li>
        );
      })}
    </ul>
  );
}
