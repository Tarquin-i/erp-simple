import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  ImageOff,
  LoaderCircle,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import type { Attachment } from "@/request/communication-attachments";

const imageTypes = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export type AttachmentDownloadError = {
  attachmentId: string;
  message: string;
};

export function canPreviewAttachment(attachment: Attachment) {
  return !attachment.deletionPending && imageTypes.has(attachment.mimeType);
}

function attachmentImageUrl(
  communicationId: string,
  attachmentId: string,
  variant: "preview" | "thumbnail"
) {
  return `/api/communications/${encodeURIComponent(communicationId)}/attachments/${encodeURIComponent(attachmentId)}/${variant}`;
}

/** 只在卡片进入可视区域时加载缩略图，失败后仍可打开原图预览。 */
export function AttachmentThumbnail({
  attachment,
  communicationId,
}: {
  attachment: Attachment;
  communicationId: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  return (
    <>
      {state === "loading" && (
        <FileImage
          aria-hidden="true"
          className="size-7 text-muted-foreground"
        />
      )}
      {state === "failed" && (
        <ImageOff aria-hidden="true" className="size-7 text-muted-foreground" />
      )}
      {state !== "failed" && (
        <img
          alt=""
          className="absolute inset-0 size-full object-contain data-[loading=true]:opacity-0"
          data-loading={state === "loading"}
          decoding="async"
          loading="lazy"
          src={attachmentImageUrl(communicationId, attachment.id, "thumbnail")}
          onError={() => setState("failed")}
          onLoad={() => setState("ready")}
        />
      )}
    </>
  );
}

function PreviewImage({
  attachment,
  communicationId,
}: {
  attachment: Attachment;
  communicationId: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attachmentImageUrl(communicationId, attachment.id, "preview");

  return (
    <div className="relative grid min-h-0 place-items-center overflow-hidden rounded-lg bg-muted/60">
      {state !== "failed" && (
        <img
          alt={attachment.fileName}
          aria-hidden={state === "loading"}
          className="absolute inset-0 size-full object-contain data-[loading=true]:opacity-0"
          data-loading={state === "loading"}
          decoding="async"
          src={attempt ? `${url}?retry=${attempt}` : url}
          onError={() => setState("failed")}
          onLoad={() => setState("ready")}
        />
      )}
      {state === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          正在加载图片
        </p>
      )}
      {state === "failed" && (
        <div className="grid justify-items-center gap-3 p-4 text-center">
          <ImageOff
            aria-hidden="true"
            className="size-7 text-muted-foreground"
          />
          <p role="alert" className="text-muted-foreground">
            图片预览暂不可用
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setState("loading");
              setAttempt((previous) => previous + 1);
            }}
          >
            重试预览
          </Button>
        </div>
      )}
    </div>
  );
}

/** 浏览时间线中的图片原件，并把关闭后的焦点交还给打开预览的卡片。 */
export function AttachmentImagePreview({
  activeId,
  communicationId,
  images,
  downloadingIds,
  downloadError,
  trigger,
  onSelect,
  onDownload,
}: {
  activeId: string | null;
  communicationId: string;
  images: readonly Attachment[];
  downloadingIds?: ReadonlySet<string>;
  downloadError?: AttachmentDownloadError;
  trigger: HTMLButtonElement | null;
  onSelect: (id: string | null) => void;
  onDownload: (attachment: Attachment) => void;
}) {
  const index = images.findIndex(({ id }) => id === activeId);
  const attachment = images[index];
  const previous = images[index - 1];
  const next = images[index + 1];
  const downloading = attachment && downloadingIds?.has(attachment.id);
  const downloadMessage =
    downloadError?.attachmentId === activeId
      ? downloadError.message
      : undefined;

  return (
    <Dialog
      open={Boolean(attachment)}
      onOpenChange={(open) => {
        if (!open) onSelect(null);
      }}
    >
      {attachment && (
        <DialogContent
          className="h-[min(48rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[min(72rem,calc(100%-2rem))]"
          onCloseAutoFocus={(event) => {
            if (!trigger?.isConnected) return;
            event.preventDefault();
            trigger.focus({ preventScroll: true });
          }}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            const selected =
              event.key === "ArrowLeft"
                ? previous
                : event.key === "ArrowRight"
                  ? next
                  : undefined;
            if (!selected) return;
            event.preventDefault();
            onSelect(selected.id);
          }}
          showCloseButton={false}
        >
          <DialogHeader className="min-w-0 pr-9">
            <DialogTitle className="truncate" title={attachment.fileName}>
              {attachment.fileName}
            </DialogTitle>
            <DialogDescription className={images.length < 2 ? "sr-only" : ""}>
              {images.length > 1
                ? `第 ${index + 1} 张，共 ${images.length} 张`
                : "图片附件预览"}
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              aria-label="关闭预览"
              className="absolute top-2 right-2"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
          <PreviewImage
            attachment={attachment}
            communicationId={communicationId}
            key={attachment.id}
          />
          <div className="min-w-0 space-y-2">
            {downloadMessage && (
              <FieldError className="wrap-anywhere">
                {downloadMessage}
              </FieldError>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {images.length > 1 && (
                  <>
                    <Button
                      aria-label="上一张图片"
                      disabled={!previous}
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => previous && onSelect(previous.id)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label="下一张图片"
                      disabled={!next}
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => next && onSelect(next.id)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
              <Button
                aria-busy={Boolean(downloading)}
                aria-label={`下载 ${attachment.fileName}`}
                disabled={Boolean(downloading)}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onDownload(attachment)}
              >
                {downloading ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {downloadMessage ? "重试下载" : "下载原图"}
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
