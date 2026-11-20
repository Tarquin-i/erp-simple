import {
  CalendarDays,
  ChevronDown,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  PenTool,
  Presentation,
  Trash2,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Attachment } from "@/request/communication-attachments";

import { formatFileSize } from "./file-size";
import {
  AttachmentImagePreview,
  AttachmentThumbnail,
  canPreviewAttachment,
} from "./image-preview";
import type { AttachmentDownloadError } from "./image-preview";

type AttachmentTimelineProps = {
  actionsSlot: HTMLDivElement | null;
  attachments: readonly Attachment[];
  communicationId: string;
  downloadingIds?: ReadonlySet<string>;
  downloadError?: AttachmentDownloadError;
  deletingId?: string;
  onDownload: (attachment: Attachment) => void;
  onDelete?: (attachment: Attachment) => void;
  fileActions?: ReactNode;
  empty?: ReactNode;
};

type DateGroup = {
  date: string;
  label: string;
  attachments: Attachment[];
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function groupByDate(attachments: readonly Attachment[]) {
  const groups = new Map<string, DateGroup>();
  const dated = attachments
    .map((attachment) => ({
      attachment,
      time: Date.parse(attachment.uploadedAt ?? ""),
    }))
    .sort((left, right) => (right.time || 0) - (left.time || 0));

  for (const { attachment, time } of dated) {
    const date = Number.isFinite(time) ? new Date(time) : null;
    const key = date
      ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      : "undated";
    const group = groups.get(key);
    if (group) {
      group.attachments.push(attachment);
    } else {
      groups.set(key, {
        date: key,
        label: date ? dateFormat.format(date) : "上传日期未知",
        attachments: [attachment],
      });
    }
  }
  return Array.from(groups.values());
}

const fileIcons = new Map([
  ["ai", PenTool],
  ["csv", FileSpreadsheet],
  ["doc", FileText],
  ["docx", FileText],
  ["ppt", Presentation],
  ["pptx", Presentation],
  ["txt", FileText],
  ["xls", FileSpreadsheet],
  ["xlsx", FileSpreadsheet],
  ["zip", FileArchive],
]);

function FileVisual({ attachment }: { attachment: Attachment }) {
  const extension = /\.([a-z0-9]+)$/i
    .exec(attachment.fileName)?.[1]
    ?.toLowerCase();
  if (extension === "pdf") {
    return (
      <span aria-hidden="true" className="text-lg font-semibold">
        PDF
      </span>
    );
  }

  const Icon = attachment.mimeType.startsWith("image/")
    ? FileImage
    : (fileIcons.get(extension ?? "") ?? File);
  return <Icon aria-hidden="true" className="size-8" />;
}

function AttachmentTile({
  attachment,
  communicationId,
  downloading,
  deletingId,
  onDownload,
  onDelete,
  onPreview,
}: Pick<
  AttachmentTimelineProps,
  "communicationId" | "deletingId" | "onDownload" | "onDelete"
> & {
  attachment: Attachment;
  downloading: boolean;
  onPreview: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const { id, deletionPending, fileName, fileSize, uploaderName, uploadedAt } =
    attachment;
  const deleting = id === deletingId;
  const deleteLabel = deletionPending ? "重试删除" : "删除";
  const time = Date.parse(uploadedAt ?? "");

  return (
    <Card
      className="group relative aspect-square min-w-0 gap-0 rounded-lg bg-muted/35 py-0 transition-shadow focus-within:shadow-sm hover:shadow-sm"
      data-attachment-card=""
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {canPreviewAttachment(attachment) ? (
            <Button
              aria-label={`预览 ${fileName}`}
              className="group/preview absolute inset-0 size-full cursor-zoom-in rounded-none border-0 p-0 focus-visible:ring-inset"
              type="button"
              variant="ghost"
              onClick={(event) => onPreview(id, event.currentTarget)}
            >
              <AttachmentThumbnail
                attachment={attachment}
                communicationId={communicationId}
              />
            </Button>
          ) : (
            <div
              aria-label={fileName}
              className="absolute inset-0 grid place-items-center text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              role="img"
              tabIndex={0}
            >
              <FileVisual attachment={attachment} />
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent className="grid gap-1" sideOffset={6}>
          <p className="wrap-anywhere font-medium">{fileName}</p>
          <p>{formatFileSize(fileSize)}</p>
          <p>{uploaderName}</p>
          {uploadedAt && Number.isFinite(time) && (
            <time dateTime={uploadedAt}>{timeFormat.format(time)}</time>
          )}
        </TooltipContent>
      </Tooltip>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-end gap-1 bg-linear-to-b from-black/25 to-transparent p-1.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:data-[deletion-pending=true]:opacity-100"
        data-attachment-actions=""
        data-deletion-pending={deletionPending}
      >
        {!deletionPending && (
          <Button
            aria-busy={downloading}
            aria-label={`下载 ${fileName}`}
            className="pointer-events-auto bg-black/25 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white [@media(hover:none)]:size-10"
            disabled={downloading}
            size="icon-sm"
            title="下载"
            type="button"
            variant="ghost"
            onClick={() => onDownload(attachment)}
          >
            {downloading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Download aria-hidden="true" />
            )}
          </Button>
        )}
        {onDelete && (
          <Button
            aria-busy={deleting}
            aria-label={`${deleteLabel} ${fileName}`}
            className="pointer-events-auto bg-black/25 text-white backdrop-blur-sm hover:bg-destructive/80 hover:text-white [@media(hover:none)]:size-10"
            disabled={deletingId !== undefined}
            size="icon-sm"
            title={deleteLabel}
            type="button"
            variant="ghost"
            onClick={() => onDelete(attachment)}
          >
            {deleting ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {deletionPending && (
        <Badge
          className="pointer-events-none absolute bottom-1.5 left-1.5"
          variant="secondary"
        >
          待删除
        </Badge>
      )}
      {!deletionPending && (
        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 hidden truncate rounded-sm bg-background/90 px-1.5 py-0.5 text-xs [@media(hover:none)]:block">
          {fileName}
        </span>
      )}
    </Card>
  );
}

/** 按本地日历日期列出附件，默认展开，按上传时间从新到旧展示。 */
export function AttachmentTimeline({
  actionsSlot,
  attachments,
  communicationId,
  downloadingIds,
  downloadError,
  deletingId,
  onDownload,
  onDelete,
  fileActions,
  empty,
}: AttachmentTimelineProps) {
  const idPrefix = useId();
  const groupTriggers = useRef(new Map<string, HTMLButtonElement>());
  const jumpTarget = useRef<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [preview, setPreview] = useState<{
    id: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const groups = useMemo(() => groupByDate(attachments), [attachments]);
  const images = useMemo(
    () =>
      groups.flatMap((group) => group.attachments.filter(canPreviewAttachment)),
    [groups]
  );

  function setDateCollapsed(date: string, collapsed: boolean) {
    setCollapsedDates((current) => {
      const next = new Set(current);
      if (collapsed) next.add(date);
      else next.delete(date);
      return next;
    });
  }

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className="min-w-0 space-y-4"
    >
      <h2 className="sr-only" id={`${idPrefix}-heading`}>
        附件
      </h2>
      {actionsSlot &&
        createPortal(
          <>
            {groups.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="按日期跳转附件时间线"
                    size="icon"
                    title="跳转日期"
                    type="button"
                    variant="ghost"
                  >
                    <CalendarDays aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64"
                  onCloseAutoFocus={(event) => {
                    const date = jumpTarget.current;
                    if (!date) return;
                    jumpTarget.current = null;
                    const target = groupTriggers.current.get(date);
                    if (!target) return;
                    event.preventDefault();
                    target.focus({ preventScroll: true });
                    target.scrollIntoView({
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)"
                      ).matches
                        ? "auto"
                        : "smooth",
                      block: "start",
                    });
                  }}
                >
                  {groups.map(({ date, label, attachments: items }) => (
                    <DropdownMenuItem
                      className="justify-between gap-2"
                      key={date}
                      onSelect={() => {
                        jumpTarget.current = date;
                        setDateCollapsed(date, false);
                      }}
                    >
                      <span>{label}</span>
                      <span className="text-muted-foreground text-xs">
                        {items.length} 个附件
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {fileActions}
          </>,
          actionsSlot
        )}
      {groups.length ? (
        <div aria-label="沟通附件时间线" className="space-y-4" role="group">
          {groups.map(({ date, label, attachments: items }) => {
            const collapsed = collapsedDates.has(date);
            const groupId = `${idPrefix}-${date}`;
            return (
              <section
                aria-labelledby={`${groupId}-date`}
                className="space-y-2"
                data-attachment-date={date}
                key={date}
              >
                <Button
                  aria-controls={`${groupId}-files`}
                  aria-expanded={!collapsed}
                  className="w-full scroll-mt-20 justify-start gap-2 px-1 hover:bg-muted/70 aria-expanded:bg-transparent aria-expanded:hover:bg-muted/70"
                  id={`${groupId}-date`}
                  ref={(element) => {
                    if (element) groupTriggers.current.set(date, element);
                    else groupTriggers.current.delete(date);
                  }}
                  type="button"
                  variant="ghost"
                  onClick={() => setDateCollapsed(date, !collapsed)}
                >
                  <span>{label}</span>
                  <Separator className="min-w-3 flex-1 data-horizontal:w-auto" />
                  <span className="text-muted-foreground text-xs">
                    {items.length} 个附件
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={collapsed ? "size-4 -rotate-90" : "size-4"}
                  />
                </Button>
                <ul
                  className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-2.5"
                  hidden={collapsed}
                  id={`${groupId}-files`}
                >
                  {items.map((attachment) => (
                    <li className="min-w-0" key={attachment.id}>
                      <AttachmentTile
                        attachment={attachment}
                        communicationId={communicationId}
                        deletingId={deletingId}
                        downloading={
                          downloadingIds?.has(attachment.id) ?? false
                        }
                        onDelete={onDelete}
                        onDownload={onDownload}
                        onPreview={(id, trigger) => setPreview({ id, trigger })}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        empty
      )}
      <AttachmentImagePreview
        activeId={preview?.id ?? null}
        communicationId={communicationId}
        downloadError={downloadError}
        downloadingIds={downloadingIds}
        images={images}
        trigger={preview?.trigger ?? null}
        onDownload={onDownload}
        onSelect={(id) =>
          setPreview((current) => (id && current ? { ...current, id } : null))
        }
      />
    </section>
  );
}
