import { Search } from "lucide-react";
import { type ComponentProps, type ReactNode, useRef } from "react";

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
import { InputGroupAddon } from "./input-group";

type SelectOption = { name: string; keywords?: string };

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
  container?: ComponentProps<typeof ComboboxContent>["container"];
  remoteSearch?: RemoteSearch;
  getOptionKey?: (option: Option) => string;
  renderOption?: (option: Option) => ReactNode;
  footer?: ReactNode;
  onValueChange: (option: Option) => void;
};

/** 在与触发框等宽的弹层中搜索并选择已有选项。 */
export function SearchableSelect<Option extends SelectOption>({
  id,
  items,
  value,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  container,
  remoteSearch,
  getOptionKey,
  renderOption = (option) => option.name,
  footer,
  onValueChange,
}: SearchableSelectProps<Option>) {
  const composing = useRef(false);

  return (
    <Combobox
      items={items}
      value={value}
      disabled={disabled}
      autoHighlight
      open={remoteSearch?.open}
      inputValue={remoteSearch?.query}
      onOpenChange={(open) => {
        if (!open) composing.current = false;
        remoteSearch?.onOpenChange(open);
      }}
      onInputValueChange={(query, details) => {
        if (details.reason === "input-change")
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
        render={<Button type="button" variant="outline" />}
        className="w-full min-w-0 justify-between font-normal aria-expanded:bg-background aria-expanded:[&>svg]:rotate-180 [&>svg]:transition-transform"
      >
        {value ? (
          <span className="truncate">{value.name}</span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
      </ComboboxTrigger>
      <ComboboxContent
        container={container}
        sideOffset={4}
        className="flex min-w-0 flex-col rounded-xl border bg-popover shadow-sm ring-0"
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
