import { Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

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
import { SearchableSelect } from "@/components/ui/searchable-select";

export type ProductPresetOption = { name: string; value: string };

type ProductPresetFieldProps = {
  id: string;
  label: string;
  items: readonly ProductPresetOption[];
  value: ProductPresetOption | null;
  disabled?: boolean;
  onChange: (option: ProductPresetOption) => void;
  custom?: {
    initialValue: string;
    label?: string;
    maxLength: number;
    inputMode?: "numeric";
    validate?: (value: string) => string | undefined;
    onConfirm: (value: string) => void;
  };
};

export function ProductPresetField({
  id,
  label,
  items,
  value,
  disabled,
  onChange,
  custom,
}: ProductPresetFieldProps) {
  const customInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const legacyValue =
    !custom && value && !items.some((option) => option.value === value.value)
      ? value
      : null;
  const inputId = `${id}-custom`;
  const inputLabel = custom?.label ?? label;

  function openCustomDialog() {
    setOpen(false);
    setError("");
    setCustomValue(custom?.initialValue ?? "");
  }

  function submitCustomValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Portal 里的表单事件仍会冒泡到产品表单。
    event.stopPropagation();
    if (!custom || customValue === null || disabled) return;
    const nextValue = customValue.trim();
    const problem = !nextValue
      ? `请输入${inputLabel}。`
      : nextValue.length > custom.maxLength
        ? `${inputLabel}最多填写 ${custom.maxLength} 个字符。`
        : custom.validate?.(nextValue);
    if (problem) {
      setError(problem);
      return;
    }
    custom.onConfirm(nextValue);
    setCustomValue(null);
  }

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id} preventControlActivation>
        {label}
      </FieldLabel>
      <SearchableSelect
        id={id}
        items={legacyValue ? [...items, legacyValue] : items}
        value={value}
        placeholder={`请选择${label}`}
        searchPlaceholder={`搜索${label}`}
        emptyMessage={`没有匹配的${label}`}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        required
        getOptionKey={(option) => option.value}
        isOptionDisabled={(option) => option.value === legacyValue?.value}
        onValueChange={onChange}
        footer={
          custom && (
            <div className="shrink-0 border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start font-normal"
                disabled={disabled}
                onClick={openCustomDialog}
              >
                <Plus aria-hidden="true" />
                自定义
              </Button>
            </div>
          )
        }
      />
      {custom && (
        <Dialog
          open={customValue !== null}
          onOpenChange={(next) => {
            if (!next) setCustomValue(null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              customInput.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById(id)?.focus({ preventScroll: true });
            }}
          >
            <DialogHeader>
              <DialogTitle>自定义{label}</DialogTitle>
              <DialogDescription className="sr-only">
                确认后将填入当前产品的{label}。
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={submitCustomValue}>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={inputId}>{inputLabel}</FieldLabel>
                <Input
                  id={inputId}
                  ref={customInput}
                  value={customValue ?? ""}
                  maxLength={custom.maxLength}
                  inputMode={custom.inputMode}
                  disabled={disabled}
                  aria-required="true"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  onChange={(event) => {
                    setCustomValue(event.target.value);
                    setError("");
                  }}
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
                {error && (
                  <FieldError id={`${inputId}-error`}>{error}</FieldError>
                )}
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCustomValue(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={disabled}>
                  确认
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Field>
  );
}
