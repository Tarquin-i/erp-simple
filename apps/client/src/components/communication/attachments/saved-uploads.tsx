import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

import { AttachmentQueue } from "./queue";
import type { AttachmentUploadQueue } from "./use-upload-queue";

/** 沟通保存后单独处理文件。附件重试只提交文件，同一条沟通资料保持已保存。 */
export function SavedAttachmentUploads({
  communicationId,
  queue,
  error,
  onView,
}: {
  communicationId: string;
  queue: AttachmentUploadQueue;
  error?: string;
  onView: () => void;
}) {
  return (
    <main className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">沟通记录已保存</h1>
          <p className="text-sm text-muted-foreground" role="status">
            {queue.busy
              ? "正在上传附件，请稍候。"
              : queue.items.some((item) => item.status === "failed")
                ? "部分附件未上传，你可以重试或移除这些文件。"
                : "可以前往沟通详情查看附件。"}
          </p>
        </div>
        <Button type="button" disabled={queue.busy} onClick={onView}>
          查看沟通详情
        </Button>
      </header>
      {error && <FieldError>{error}</FieldError>}
      <AttachmentQueue
        items={queue.items}
        disabled={queue.busy}
        onRetry={(id) => void queue.upload(communicationId, id)}
        onRemove={queue.remove}
      />
    </main>
  );
}
