import { Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

type AttachmentQueueStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "completing"
  | "succeeded"
  | "failed";

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
};

const fileSizeFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});

function formatFileSize(bytes: number) {
  const kibibytes = bytes / 1024;
  if (kibibytes < 1) return `${bytes} B`;
  if (kibibytes < 1024) return `${fileSizeFormat.format(kibibytes)} KB`;
  return `${fileSizeFormat.format(kibibytes / 1024)} MB`;
}

/** 显示队列状态、上传进度和可用的操作。 */
export function AttachmentQueue({
  items,
  disabled = false,
  onRetry,
  onRemove,
}: AttachmentQueueProps) {
  if (!items.length) return null;

  return (
    <ul aria-label="待上传附件" className="divide-y rounded-lg border">
      {items.map(({ id, file, status, progress, error, retryable }) => {
        const uploadProgress =
          progress === undefined
            ? undefined
            : Math.min(100, Math.max(0, Math.round(progress)));
        const canRetry = onRetry && status === "failed" && retryable !== false;
        const canRemove =
          onRemove && (status === "queued" || status === "failed");
        return (
          <li key={id} className="flex gap-3 px-3 py-2.5">
            <Paperclip
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-sm font-medium wrap-anywhere">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
                <Badge
                  role="status"
                  variant={status === "failed" ? "destructive" : "secondary"}
                >
                  {statusLabels[status]}
                </Badge>
              </div>
              {status === "uploading" && (
                <div className="flex items-center gap-2">
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
              {error && <FieldError>{error}</FieldError>}
            </div>
            {(canRetry || canRemove) && (
              <div className="flex shrink-0 items-start gap-1">
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
                    aria-label={`移除 ${file.name}`}
                    disabled={disabled}
                    onClick={() => onRemove(id)}
                  >
                    移除
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
