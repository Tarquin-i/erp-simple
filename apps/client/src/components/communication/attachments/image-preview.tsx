import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileImage,
  ImageOff,
  LoaderCircle,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

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

/**
 * 惰性加载缩略图。首次失败时稍后重试一次，仍失败时提示查看原图。
 * @param props.attachment 当前图片附件。
 * @param props.communicationId 附件所属的沟通记录 ID。
 * @returns 方形卡片内的缩略图、加载占位或失败提示。
 */
export function AttachmentThumbnail({
  attachment,
  communicationId,
}: {
  attachment: Attachment;
  communicationId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    "loading" | "waiting" | "ready" | "failed"
  >("loading");
  const url = attachmentImageUrl(communicationId, attachment.id, "thumbnail");

  useEffect(() => {
    if (state !== "waiting") return;
    const timer = window.setTimeout(() => {
      setAttempt(1);
      setState("loading");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <>
      {(state === "loading" || state === "waiting") && (
        <FileImage
          aria-hidden="true"
          className="size-7 text-muted-foreground"
        />
      )}
      {state === "failed" && (
        <span className="grid justify-items-center gap-1 px-2 text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-7" />
          <span className="max-w-24 text-wrap text-center text-xs leading-tight">
            缩略图加载失败，点击查看原图。
          </span>
        </span>
      )}
      {(state === "loading" || state === "ready") && (
        <img
          alt=""
          className="absolute inset-0 size-full object-contain data-[loading=true]:opacity-0"
          data-loading={state === "loading"}
          decoding="async"
          loading="lazy"
          src={attempt ? `${url}?retry=${attempt}` : url}
          onError={() => setState(attempt ? "failed" : "waiting")}
          onLoad={() => setState("ready")}
        />
      )}
      {state === "ready" && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25 text-white opacity-0 transition-opacity group-focus-visible/preview:opacity-100 [@media(hover:hover)]:group-hover/preview:opacity-100"
        >
          <Eye className="size-5" />
        </span>
      )}
    </>
  );
}

type ImageView = { scale: number; x: number; y: number };

type ImagePan = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const centeredView: ImageView = { scale: 1, x: 0, y: 0 };
const minImageScale = 0.5;
const maxImageScale = 3;
const imageScaleStep = 0.25;

function constrainImageView(
  view: ImageView,
  image: HTMLImageElement | null,
  viewport: HTMLDivElement | null
): ImageView {
  const { scale, x, y } = view;
  if (scale <= 1 || !image || !viewport) return { scale, x: 0, y: 0 };
  const maxX = Math.max(
    0,
    (image.offsetWidth * scale - viewport.clientWidth) / 2
  );
  const maxY = Math.max(
    0,
    (image.offsetHeight * scale - viewport.clientHeight) / 2
  );
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
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
  const [view, setView] = useState(centeredView);
  const [panning, setPanning] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<ImagePan | null>(null);
  const url = attachmentImageUrl(communicationId, attachment.id, "preview");
  const zoomed = view.scale > 1;

  const setScale = useCallback((getScale: (scale: number) => number) => {
    setView((current) => {
      const scale = Math.min(
        maxImageScale,
        Math.max(minImageScale, getScale(current.scale))
      );
      return scale === current.scale
        ? current
        : constrainImageView(
            { ...current, scale },
            imageRef.current,
            viewportRef.current
          );
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (state !== "ready" || !viewport) return;

    // 在画布内消费滚轮事件，缩放时不滚动底层页面。
    function zoomWithWheel(event: WheelEvent) {
      if (!event.deltaY) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? window.innerHeight
            : 1);
      setScale((scale) => scale * Math.exp(-delta * 0.0015));
    }

    const observer = new ResizeObserver(() => {
      setView((current) => {
        const next = constrainImageView(current, imageRef.current, viewport);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    });
    viewport.addEventListener("wheel", zoomWithWheel, { passive: false });
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("wheel", zoomWithWheel);
      observer.disconnect();
    };
  }, [setScale, state]);

  function startPan(event: PointerEvent<HTMLImageElement>) {
    if (!zoomed || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    setPanning(true);
  }

  function movePan(event: PointerEvent<HTMLImageElement>) {
    const pan = panRef.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const x = pan.originX + event.clientX - pan.startX;
    const y = pan.originY + event.clientY - pan.startY;
    setView((current) =>
      constrainImageView(
        { ...current, x, y },
        imageRef.current,
        viewportRef.current
      )
    );
  }

  function endPan(event: PointerEvent<HTMLImageElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
  }

  return (
    <>
      <div
        className="absolute inset-x-0 top-0 bottom-0 flex items-center justify-center overflow-hidden p-4 data-[ready=true]:bottom-16"
        data-ready={state === "ready"}
        ref={viewportRef}
      >
        <DialogClose asChild>
          <Button
            aria-label="关闭图片预览画布"
            className="absolute inset-0 size-full cursor-zoom-out rounded-none p-0 hover:bg-transparent"
            tabIndex={-1}
            type="button"
            variant="ghost"
          />
        </DialogClose>
        {state !== "failed" && (
          <img
            alt={attachment.fileName}
            aria-hidden={state === "loading"}
            className="relative z-10 max-h-full max-w-full shrink-0 object-contain select-none data-[dragging=true]:cursor-grabbing data-[loading=true]:pointer-events-none data-[loading=true]:absolute data-[loading=true]:opacity-0 data-[zoomed=true]:touch-none data-[zoomed=true]:not-data-[dragging=true]:cursor-grab"
            data-dragging={panning}
            data-loading={state === "loading"}
            data-zoomed={zoomed}
            decoding="async"
            draggable={false}
            ref={imageRef}
            src={attempt ? `${url}?retry=${attempt}` : url}
            style={{
              transform: `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`,
            }}
            onError={() => setState("failed")}
            onLoad={() => setState("ready")}
            onLostPointerCapture={endPan}
            onPointerCancel={endPan}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
          />
        )}
        {state === "loading" && (
          <p
            role="status"
            className="pointer-events-none relative flex items-center gap-2 text-muted-foreground"
          >
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            正在加载图片
          </p>
        )}
        {state === "failed" && (
          <div className="relative grid justify-items-center gap-3 p-4 text-center">
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
                setView(centeredView);
                setState("loading");
                setAttempt((previous) => previous + 1);
              }}
            >
              重试预览
            </Button>
          </div>
        )}
      </div>
      {state === "ready" && (
        <div
          aria-label="图片缩放"
          className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full border bg-background p-1 shadow-sm"
          role="group"
        >
          <Button
            aria-label="缩小图片"
            disabled={view.scale <= minImageScale}
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => setScale((scale) => scale - imageScaleStep)}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Button
            aria-label={`还原图片缩放，当前 ${Math.round(view.scale * 100)}%`}
            className="min-w-14 tabular-nums"
            title="适应窗口"
            type="button"
            variant="ghost"
            onClick={() => setView(centeredView)}
          >
            {Math.round(view.scale * 100)}%
          </Button>
          <Button
            aria-label="放大图片"
            disabled={view.scale >= maxImageScale}
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => setScale((scale) => scale + imageScaleStep)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
        </div>
      )}
    </>
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
  const closeButton = useRef<HTMLButtonElement>(null);
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
          className="top-0 left-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 animate-none! grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 ring-0 sm:max-w-none"
          onOpenAutoFocus={(event) => {
            if (!closeButton.current) return;
            event.preventDefault();
            closeButton.current.focus();
          }}
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
          <DialogHeader className="min-w-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-6">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="truncate" title={attachment.fileName}>
                  {attachment.fileName}
                </DialogTitle>
                <DialogDescription
                  className={images.length < 2 ? "sr-only" : ""}
                >
                  {images.length > 1
                    ? `第 ${index + 1} 张，共 ${images.length} 张`
                    : "图片附件预览"}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  aria-busy={Boolean(downloading)}
                  aria-label={`下载 ${attachment.fileName}`}
                  disabled={Boolean(downloading)}
                  size="sm"
                  type="button"
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
                <DialogClose asChild>
                  <Button
                    aria-label="关闭预览"
                    ref={closeButton}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </DialogClose>
              </div>
            </div>
            {downloadMessage && (
              <FieldError className="wrap-anywhere">
                {downloadMessage}
              </FieldError>
            )}
          </DialogHeader>
          <div className="relative min-h-0 overflow-hidden bg-muted/60">
            <PreviewImage
              attachment={attachment}
              communicationId={communicationId}
              key={attachment.id}
            />
            {images.length > 1 && (
              <>
                <Button
                  aria-label="上一张图片"
                  className="absolute top-[calc(50%-2rem)] left-3 z-20 size-10 -translate-y-1/2 rounded-full shadow-sm"
                  disabled={!previous}
                  size="icon"
                  type="button"
                  variant="outline"
                  onClick={() => previous && onSelect(previous.id)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  aria-label="下一张图片"
                  className="absolute top-[calc(50%-2rem)] right-3 z-20 size-10 -translate-y-1/2 rounded-full shadow-sm"
                  disabled={!next}
                  size="icon"
                  type="button"
                  variant="outline"
                  onClick={() => next && onSelect(next.id)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
