import { Check, CircleOff } from "lucide-react";
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
  { value: "#dc2626", label: "红色", checkClassName: "text-white" },
  { value: "#ea580c", label: "橙色", checkClassName: "text-neutral-950" },
  { value: "#eab308", label: "黄色", checkClassName: "text-neutral-950" },
  { value: "#15803d", label: "绿色", checkClassName: "text-white" },
  { value: "#2563eb", label: "蓝色", checkClassName: "text-white" },
  { value: "#9333ea", label: "紫色", checkClassName: "text-white" },
] as const;

type OptionEditorDialogProps = {
  open: boolean;
  title: string;
  description: string;
  showDescription?: boolean;
  inputId: string;
  inputLabel: string;
  value: string;
  maxLength: number;
  onValueChange?: (value: string) => void;
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
  color?: {
    value: string | null;
    onChange: (color: string | null) => void;
    original?: string | null;
  };
};

export function OptionEditorDialog({
  open,
  title,
  description,
  showDescription,
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
}: OptionEditorDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLFieldSetElement>(null);
  const errorId = `${inputId}-error`;
  const originalColor = color?.original;
  const colorChoices =
    originalColor && !presetColors.some(({ value }) => value === originalColor)
      ? [
          ...presetColors,
          {
            value: originalColor,
            label: `原颜色（${originalColor}）`,
            checkClassName: "rounded-sm bg-popover text-foreground",
          },
        ]
      : presetColors;

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
          const currentColor = !onValueChange
            ? palette.current?.querySelector<HTMLButtonElement>(
                '[aria-pressed="true"]'
              )
            : undefined;
          (currentColor ?? input.current).focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={showDescription ? undefined : "sr-only"}>
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
              readOnly={busy || !onValueChange}
              aria-required={onValueChange ? true : undefined}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => onValueChange?.(event.target.value)}
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
            <fieldset ref={palette} disabled={disabled || busy}>
              <legend className="mb-2 text-sm font-medium">颜色</legend>
              <div className="flex flex-wrap gap-1 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="aria-pressed:border-foreground"
                  aria-label="默认颜色"
                  aria-pressed={color.value === null}
                  title="默认颜色"
                  onClick={() => color.onChange(null)}
                >
                  <CircleOff aria-hidden="true" />
                </Button>
                {colorChoices.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="aria-pressed:border-foreground"
                    aria-label={preset.label}
                    aria-pressed={color.value === preset.value}
                    title={preset.label}
                    onClick={() => color.onChange(preset.value)}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-5 place-items-center rounded-sm"
                      style={{ backgroundColor: preset.value }}
                    >
                      {color.value === preset.value && (
                        <Check
                          className={`size-3.5 ${preset.checkClassName}`}
                        />
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
