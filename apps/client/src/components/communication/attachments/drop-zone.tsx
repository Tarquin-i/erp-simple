import { Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { toastManager } from "@/components/ui/toast";
import { getCommunicationAttachmentUploadLimit } from "@/request/communication-attachments";

import { formatAttachmentUploadLimit } from "./file-size";

export const attachmentEncodingHint = "CSV、TXT 文件需使用 UTF-8 编码。";

type AttachmentDropZoneProps = {
  accept: string;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  children?: (picker: {
    selectFiles: () => void;
    selectionDisabled: boolean;
    dropButton: ReactNode;
  }) => ReactNode;
};

function isInsideDropZone(event: DragEvent<HTMLDivElement>) {
  return (
    event.target instanceof Node && event.currentTarget.contains(event.target)
  );
}

/** 提供可用鼠标、键盘或拖放操作的多文件选择入口。 */
export function AttachmentDropZone({
  accept,
  disabled = false,
  onFilesSelected,
  children,
}: AttachmentDropZoneProps) {
  const encodingHintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [limit, setLimit] = useState<number | Error>();
  const [limitRetry, setLimitRetry] = useState(0);
  const selectionDisabled = disabled || typeof limit !== "number";

  useEffect(() => {
    const controller = new AbortController();
    void getCommunicationAttachmentUploadLimit(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setLimit(value);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setLimit(
            failure instanceof Error
              ? failure
              : new Error("暂时无法获取附件大小限制。")
          );
        }
      }
    );
    return () => controller.abort();
  }, [limitRetry]);

  useEffect(() => {
    if (selectionDisabled) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  }, [selectionDisabled]);

  function selectFiles() {
    if (!selectionDisabled) input.current?.click();
  }

  function acceptFiles(files: File[]) {
    if (disabled || typeof limit !== "number") return;

    const accepted: File[] = [];
    for (const file of files) {
      if (file.size > limit) {
        toastManager.add({
          title: `「${file.name}」超过单个附件大小上限（${formatAttachmentUploadLimit(limit)}）。`,
          type: "error",
        });
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length > 0) onFilesSelected(accepted);
  }

  const dropButton = (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-h-32 w-full flex-col gap-2 rounded-xl border-dashed px-4 py-6 text-muted-foreground data-[drag-active=true]:border-primary data-[drag-active=true]:bg-muted"
      aria-label="选择附件"
      aria-describedby={encodingHintId}
      data-drag-active={dragActive && !selectionDisabled}
      disabled={selectionDisabled}
      onClick={selectFiles}
    >
      <Upload aria-hidden="true" className="size-5" />
      拖拽或点击此处上传
      <span id={encodingHintId} className="text-xs font-normal">
        {attachmentEncodingHint}
      </span>
    </Button>
  );

  return (
    <div
      className={children ? "relative min-w-0 rounded-lg" : undefined}
      data-drag-active={dragActive && !selectionDisabled}
      onDragEnter={(event) => {
        if (
          !isInsideDropZone(event) ||
          !event.dataTransfer.types.includes("Files")
        )
          return;
        event.preventDefault();
        if (selectionDisabled) return;
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (
          !isInsideDropZone(event) ||
          !event.dataTransfer.types.includes("Files")
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = selectionDisabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!isInsideDropZone(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        if (
          !isInsideDropZone(event) ||
          !event.dataTransfer.types.includes("Files")
        )
          return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        acceptFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {limit instanceof Error && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FieldError>{limit.message}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLimit(undefined);
              setLimitRetry((value) => value + 1);
            }}
          >
            重试读取附件大小限制
          </Button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        disabled={selectionDisabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          acceptFiles(files);
        }}
      />
      {children ? (
        <>
          <div className="space-y-4">
            {children({ selectFiles, selectionDisabled, dropButton })}
          </div>
          {dragActive && !selectionDisabled && (
            <output className="pointer-events-none absolute inset-0 z-10 grid content-center justify-items-center gap-2 rounded-lg border-2 border-primary/50 border-dashed bg-background text-sm font-medium">
              <Upload aria-hidden="true" className="size-5" />
              松开鼠标上传附件
              <span className="text-xs font-normal text-muted-foreground">
                {attachmentEncodingHint}
              </span>
            </output>
          )}
        </>
      ) : (
        dropButton
      )}
    </div>
  );
}
