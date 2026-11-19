import { cn } from "cn";
import { Search } from "lucide-react";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";

import { Button } from "./button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./combobox";
import { InputGroupAddon, InputGroupButton } from "./input-group";

type SelectOption = { name: string; keywords?: string; code?: string };

type RemoteSearch = {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
};

type SearchableSelectProps<Option extends SelectOption> = {
  id: string;
  items: readonly Option[];
  value: Option | null;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
  required?: boolean;
  container?: ComponentProps<typeof ComboboxContent>["container"];
  triggerClassName?: string;
  compactTrigger?: { label: string; ariaLabel: string };
  prioritizeCodeMatch?: boolean;
  remoteSearch?: RemoteSearch;
  getOptionKey?: (option: Option) => string;
  renderOption?: (option: Option) => ReactNode;
  footer?: ReactNode;
  onValueChange: (option: Option) => void;
};

/** 有下拉选项的搜索选择框，支持表单字段和紧凑的输入框附加按钮。 */
export function SearchableSelect<Option extends SelectOption>({
  id,
  items,
  value,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  required,
  container,
  triggerClassName,
  compactTrigger,
  prioritizeCodeMatch,
  remoteSearch,
  getOptionKey,
  renderOption = (option) => option.name,
  footer,
  onValueChange,
}: SearchableSelectProps<Option>) {
  const composing = useRef(false);
  const [codeQuery, setCodeQuery] = useState("");
  const exactMatch = codeQuery
    ? items.find((option) => option.code?.toUpperCase() === codeQuery)
    : undefined;
  // 保留模糊搜索结果，把精确代码放在第一条供下拉组件自动高亮。
  const orderedItems =
    exactMatch && exactMatch !== items[0]
      ? [exactMatch, ...items.filter((option) => option !== exactMatch)]
      : items;

  return (
    <Combobox
      items={orderedItems}
      value={value}
      disabled={disabled}
      autoHighlight
      open={remoteSearch?.open}
      inputValue={remoteSearch?.query}
      onOpenChange={(open) => {
        if (!open) {
          composing.current = false;
          if (prioritizeCodeMatch) setCodeQuery("");
        }
        remoteSearch?.onOpenChange(open);
      }}
      onInputValueChange={(query, details) => {
        if (details.reason !== "input-change") return;
        if (prioritizeCodeMatch) setCodeQuery(query.trim().toUpperCase());
        remoteSearch?.onQueryChange(query);
      }}
      itemToStringLabel={(option) => option.name}
      isItemEqualToValue={
        getOptionKey
          ? (option, selected) =>
              getOptionKey(option) === getOptionKey(selected)
          : undefined
      }
      filter={
        remoteSearch
          ? null
          : (option, query) =>
              `${option.name} ${option.keywords ?? ""}`
                .toLowerCase()
                .includes(query.trim().toLowerCase())
      }
      onValueChange={(option) => {
        if (option) onValueChange(option);
      }}
    >
      <ComboboxTrigger
        id={id}
        aria-label={compactTrigger?.ariaLabel}
        aria-required={required}
        render={
          compactTrigger ? (
            <InputGroupButton />
          ) : (
            <Button type="button" variant="outline" />
          )
        }
        className={cn(
          "aria-expanded:[&>svg]:rotate-180 [&>svg]:transition-transform",
          !compactTrigger &&
            "w-full min-w-0 justify-between font-normal aria-expanded:bg-background",
          triggerClassName
        )}
      >
        {compactTrigger ? (
          compactTrigger.label
        ) : value ? (
          <span className="truncate">{value.name}</span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
      </ComboboxTrigger>
      <ComboboxContent
        container={container}
        sideOffset={4}
        className={cn(
          "flex min-w-0 flex-col rounded-xl border bg-popover shadow-sm ring-0",
          compactTrigger && "w-64"
        )}
      >
        <div className="shrink-0 border-b px-2">
          <ComboboxInput
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            showTrigger={false}
            maxLength={256}
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
                event.keyCode === 229
              ) {
                event.preventBaseUIHandler();
              } else if (
                !event.currentTarget.getAttribute("aria-activedescendant")
              ) {
                event.preventDefault();
              }
            }}
          >
            <InputGroupAddon align="inline-start">
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </ComboboxInput>
        </div>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList
          showScrollbar
          className="min-h-0 w-full [scrollbar-width:thin]"
        >
          {(option: Option) => (
            <ComboboxItem
              key={getOptionKey?.(option) ?? option.name}
              value={option}
              className="min-h-8 pl-2.5"
            >
              {renderOption(option)}
            </ComboboxItem>
          )}
        </ComboboxList>
        {footer}
      </ComboboxContent>
    </Combobox>
  );
}

/** 弹窗内的下拉已展开时，让 Esc 先关闭下拉。 */
export function keepDialogOpenOnComboboxEscape(
  event: KeyboardEvent,
  content: HTMLElement | null
) {
  if (content?.querySelector('[role="combobox"][aria-expanded="true"]')) {
    event.preventDefault();
  }
}
