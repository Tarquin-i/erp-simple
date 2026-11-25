import { Search, Plus, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { ComboboxInput } from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";

export const formDropdownStyles = {
  trigger:
    "h-8 w-full min-w-0 justify-between font-normal aria-expanded:bg-background",
  popup: "flex min-w-0 flex-col rounded-xl border bg-popover shadow-sm ring-0",
  option: "min-h-8 pl-2.5",
  chevron: "aria-expanded:[&>svg]:rotate-180 [&>svg]:transition-transform",
  list: "min-h-0 w-full [scrollbar-width:thin]",
};

export type DropdownAction = {
  label: string;
  onClick: () => void;
};

export function DropdownSearch({
  placeholder,
  maxLength = 256,
}: {
  placeholder: string;
  maxLength?: number;
}) {
  const composing = useRef(false);

  return (
    <div className="shrink-0 border-b px-2">
      <ComboboxInput
        aria-label={placeholder}
        placeholder={placeholder}
        showTrigger={false}
        maxLength={maxLength}
        className="h-9 w-full rounded-none border-0 bg-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 [&_[data-slot=input-group-addon]:empty]:hidden"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            event.preventBaseUIHandler();
          } else if (
            !event.currentTarget.getAttribute("aria-activedescendant")
          ) {
            // 下拉里没有高亮选项时，回车不能误提交父表单。
            event.preventDefault();
          }
        }}
      >
        <InputGroupAddon align="inline-start">
          <Search aria-hidden="true" />
        </InputGroupAddon>
      </ComboboxInput>
    </div>
  );
}

export function DropdownFooter({
  action,
  onClear,
  disabled,
}: {
  action?: DropdownAction;
  onClear?: () => void;
  disabled?: boolean;
}) {
  if (!action && !onClear) return null;

  return (
    <div className="flex shrink-0 gap-1 border-t p-1">
      {action && (
        <Button
          type="button"
          variant="ghost"
          className="min-w-0 flex-1 justify-start font-normal"
          disabled={disabled}
          onClick={action.onClick}
        >
          <Plus aria-hidden="true" />
          <span className="truncate">{action.label}</span>
        </Button>
      )}
      {onClear && (
        <Button
          type="button"
          variant="ghost"
          className="ml-auto font-normal"
          disabled={disabled}
          onClick={onClear}
        >
          <X aria-hidden="true" />
          清空
        </Button>
      )}
    </div>
  );
}
