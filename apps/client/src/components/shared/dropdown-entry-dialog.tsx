import { Check } from "lucide-react";
import { type ComponentProps, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const presetColors = [
  { value: "red", label: "红色", className: "bg-red-600" },
  { value: "orange", label: "橙色", className: "bg-orange-600" },
  { value: "yellow", label: "黄色", className: "bg-yellow-500" },
  { value: "green", label: "绿色", className: "bg-green-700" },
  { value: "blue", label: "蓝色", className: "bg-blue-600" },
  { value: "purple", label: "紫色", className: "bg-purple-600" },
] as const;

type DropdownEntryDialogProps = {
  open: boolean;
  title: string;
  description: string;
  inputId: string;
  inputLabel: string;
  value: string;
  maxLength: number;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
  placeholder?: string;
  inputMode?: ComponentProps<typeof Input>["inputMode"];
  error?: string;
  disabled?: boolean;
  busy?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  busyLabel?: string;
  color?: { value: string | null; onChange: (color: string) => void };
};

export function DropdownEntryDialog({
  open,
  title,
  description,
  inputId,
  inputLabel,
  value,
  maxLength,
  onValueChange,
  onConfirm,
  onOpenChange,
  onCloseAutoFocus,
  placeholder,
  inputMode,
  error,
  disabled,
  busy,
  submitDisabled,
  submitLabel = "确认",
  busyLabel = "正在保存…",
  color,
}: DropdownEntryDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const errorId = `${inputId}-error`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (!input.current || disabled) return;
          event.preventDefault();
          input.current.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            // Portal 内的提交事件也会冒泡到父表单。
            event.stopPropagation();
            if (!disabled && !busy && !submitDisabled) onConfirm();
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={inputId}>{inputLabel}</FieldLabel>
            <Input
              id={inputId}
              ref={input}
              placeholder={placeholder}
              value={value}
              maxLength={maxLength}
              inputMode={inputMode}
              disabled={disabled}
              readOnly={busy}
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229)
                ) {
                  event.preventDefault();
                }
              }}
            />
            {error && <FieldError id={errorId}>{error}</FieldError>}
          </Field>
          {color && (
            <fieldset disabled={disabled || busy}>
              <legend className="mb-2 text-sm font-medium">颜色</legend>
              <div className="flex flex-wrap gap-2">
                {presetColors.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="aria-pressed:border-foreground"
                    aria-label={preset.label}
                    aria-pressed={color.value === preset.value}
                    onClick={() => color.onChange(preset.value)}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-5 place-items-center rounded-sm text-white ${preset.className}`}
                    >
                      {color.value === preset.value && (
                        <Check className="size-3.5 drop-shadow-sm" />
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            </fieldset>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={disabled || busy || submitDisabled}>
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
