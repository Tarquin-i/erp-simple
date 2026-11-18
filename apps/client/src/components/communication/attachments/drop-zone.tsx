import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type AttachmentDropZoneProps = {
  accept: string;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
};

/** 提供可用鼠标、键盘或拖放操作的多文件选择入口。 */
export function AttachmentDropZone({
  accept,
  disabled = false,
  onFilesSelected,
}: AttachmentDropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  return (
    <div
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
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
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-32 w-full flex-col gap-2 rounded-xl border-dashed px-4 py-6 text-muted-foreground data-[drag-active=true]:border-primary data-[drag-active=true]:bg-muted"
        aria-label="选择附件"
        data-drag-active={dragActive && !disabled}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" className="size-5" />
        拖拽或点击此处上传
      </Button>
    </div>
  );
}
