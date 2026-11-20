import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";

type AttachmentDropZoneProps = {
  accept: string;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  children?: (picker: {
    selectFiles: () => void;
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
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  useEffect(() => {
    if (disabled) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  }, [disabled]);
  const selectFiles = () => input.current?.click();
  const dropButton = (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-h-32 w-full flex-col gap-2 rounded-xl border-dashed px-4 py-6 text-muted-foreground data-[drag-active=true]:border-primary data-[drag-active=true]:bg-muted"
      aria-label="选择附件"
      data-drag-active={dragActive && !disabled}
      disabled={disabled}
      onClick={selectFiles}
    >
      <Upload aria-hidden="true" className="size-5" />
      拖拽或点击此处上传
    </Button>
  );

  return (
    <div
      className={children ? "relative min-w-0 rounded-lg" : undefined}
      data-drag-active={dragActive && !disabled}
      onDragEnter={(event) => {
        if (
          !isInsideDropZone(event) ||
          !event.dataTransfer.types.includes("Files")
        )
          return;
        event.preventDefault();
        if (disabled) return;
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
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
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
        const files = Array.from(event.dataTransfer.files);
        if (!disabled && files.length) onFilesSelected(files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (!disabled && files.length) onFilesSelected(files);
        }}
      />
      {children ? (
        <>
          <div className="space-y-4">
            {children({ selectFiles, dropButton })}
          </div>
          {dragActive && !disabled && (
            <output className="pointer-events-none absolute inset-0 z-10 grid content-center justify-items-center gap-2 rounded-lg border-2 border-primary/50 border-dashed bg-background text-sm font-medium">
              <Upload aria-hidden="true" className="size-5" />
              松开鼠标上传附件
            </output>
          )}
        </>
      ) : (
        dropButton
      )}
    </div>
  );
}
