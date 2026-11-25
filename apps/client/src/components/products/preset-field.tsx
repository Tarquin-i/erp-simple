import { useState } from "react";

import { DropdownEntryDialog } from "@/components/shared/dropdown-entry-dialog";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Field, FieldLabel } from "@/components/ui/field";

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
  const [customValue, setCustomValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const legacyValue =
    !custom && value && !items.some((option) => option.value === value.value)
      ? value
      : null;
  const inputId = `${id}-custom`;
  const inputLabel = custom?.label ?? label;

  function openCustomDialog() {
    setError("");
    setCustomValue(custom?.initialValue ?? "");
  }

  function submitCustomValue() {
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
        disabled={disabled}
        required
        getOptionKey={(option) => option.value}
        isOptionDisabled={(option) => option.value === legacyValue?.value}
        onValueChange={onChange}
        action={custom && { label: "自定义", onClick: openCustomDialog }}
      />
      {custom && (
        <DropdownEntryDialog
          open={customValue !== null}
          title={`自定义${label}`}
          description={`确认后将填入当前产品的${label}。`}
          inputId={inputId}
          inputLabel={inputLabel}
          value={customValue ?? ""}
          maxLength={custom.maxLength}
          inputMode={custom.inputMode}
          error={error}
          disabled={disabled}
          onValueChange={(nextValue) => {
            setCustomValue(nextValue);
            setError("");
          }}
          onConfirm={submitCustomValue}
          onOpenChange={(next) => {
            if (!next) setCustomValue(null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(id)?.focus({ preventScroll: true });
          }}
        />
      )}
    </Field>
  );
}
