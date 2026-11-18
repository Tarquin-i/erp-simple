import { LoaderCircle, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AttachmentRow = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderUserId: string;
  uploaderName: string;
  uploadedAt: string | null;
  deletionPending: boolean;
};

type AttachmentTableProps = {
  attachments: readonly AttachmentRow[];
  downloadingIds?: ReadonlySet<string>;
  deletingId?: string;
  disabled?: boolean;
  onDownload: (attachment: AttachmentRow) => void;
  onDelete?: (attachment: AttachmentRow) => void;
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 列出已上传的附件，也保留等待存储清理的行以便重试。 */
export function AttachmentTable({
  attachments,
  downloadingIds,
  deletingId,
  disabled = false,
  onDownload,
  onDelete,
}: AttachmentTableProps) {
  if (!attachments.length) {
    return (
      <Empty className="min-h-36 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Paperclip aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>暂无附件</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table aria-label="沟通附件列表" className="min-w-124 table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-2/5">文件名</TableHead>
          <TableHead>上传人员</TableHead>
          <TableHead className="w-36">上传时间</TableHead>
          {onDelete && <TableHead className="w-20 text-right">操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {attachments.map((attachment) => {
          const { id, fileName, uploaderName, uploadedAt, deletionPending } =
            attachment;
          const downloading = downloadingIds?.has(id) ?? false;
          const deleting = deletingId === id;
          const deletionLabel = deletionPending ? "重试删除" : "删除";
          return (
            <TableRow key={id}>
              <TableCell className="whitespace-normal">
                {deletionPending ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="wrap-anywhere">{fileName}</span>
                    <Badge variant="secondary">待删除</Badge>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    aria-label={`下载 ${fileName}`}
                    aria-busy={downloading}
                    disabled={disabled || downloading}
                    className="h-auto w-full justify-start p-0 text-left whitespace-normal"
                    onClick={() => onDownload(attachment)}
                  >
                    {downloading && (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    )}
                    <span className="wrap-anywhere">{fileName}</span>
                  </Button>
                )}
              </TableCell>
              <TableCell className="whitespace-normal wrap-anywhere">
                {uploaderName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {uploadedAt ? (
                  <time dateTime={uploadedAt}>
                    {dateFormat.format(new Date(uploadedAt))}
                  </time>
                ) : (
                  "—"
                )}
              </TableCell>
              {onDelete && (
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`${deletionLabel} ${fileName}`}
                    disabled={disabled || deletingId !== undefined}
                    onClick={() => onDelete(attachment)}
                  >
                    {deleting ? "删除中…" : deletionLabel}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
