"use client";

import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useDebouncedChange } from "../hooks/use-debounced-change";

export function DebouncedInput({
  value: externalValue,
  onChange,
  debounceMs = 500,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  debounceMs?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  const [draft, setDraft] = useState({
    externalValue,
    value: externalValue,
    pending: false,
  });

  if (!Object.is(draft.externalValue, externalValue)) {
    setDraft({ externalValue, value: externalValue, pending: false });
  }

  useDebouncedChange(
    draft.pending ? draft.value : null,
    (value) => {
      setDraft((current) => ({ ...current, pending: false }));
      onChange(value);
    },
    debounceMs
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft({ externalValue, value: event.target.value, pending: true });
  };

  return <Input {...props} value={draft.value} onChange={handleChange} />;
}
