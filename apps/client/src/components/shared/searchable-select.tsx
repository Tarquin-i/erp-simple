import { cn } from "cn";
import { Check, ChevronDown } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  type DropdownAction,
  SelectFooter,
  SelectSearchInput,
  formDropdownStyles,
} from "./select-popup-parts";

type SelectOption = { name: string; keywords?: string; code?: string };

type RemoteSearch = {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
};

type SearchableSelectProps<Option extends SelectOption> = Pick<
  ComponentProps<"button">,
  "aria-label" | "aria-invalid" | "aria-describedby"
> & {
  id: string;
  items: readonly Option[];
  value: Option | null;
  placeholder: string;
  searchPlaceholder: string;
  showSearch?: boolean;
  emptyMessage: string;
  disabled?: boolean;
  busy?: boolean;
  required?: boolean;
  container?: ComponentProps<typeof ComboboxContent>["container"];
  triggerClassName?: string;
  compactTrigger?: { label: string; ariaLabel: string };
  prioritizeCodeMatch?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  remoteSearch?: RemoteSearch;
  getOptionKey?: (option: Option) => string;
  isOptionDisabled?: (option: Option) => boolean;
  renderOption?: (option: Option) => ReactNode;
  footer?: ReactNode;
  action?: DropdownAction;
  onClear?: () => void;
  onValueChange: (option: Option) => void;
};

/** 有下拉选项的搜索选择框，支持表单字段和紧凑的输入框附加按钮。 */
export function SearchableSelect<Option extends SelectOption>({
  id,
  items,
  value,
  placeholder,
  searchPlaceholder,
  showSearch = true,
  emptyMessage,
  disabled,
  busy,
  required,
  container,
  triggerClassName,
  compactTrigger,
  prioritizeCodeMatch,
  open,
  onOpenChange,
  remoteSearch,
  getOptionKey,
  isOptionDisabled,
  renderOption = (option) => option.name,
  footer,
  action,
  onClear,
  onValueChange,
  ...triggerAria
}: SearchableSelectProps<Option>) {
  const [localOpen, setLocalOpen] = useState(false);
  const [codeQuery, setCodeQuery] = useState("");
  const exactMatch = codeQuery
    ? items.find((option) => option.code?.toUpperCase() === codeQuery)
    : undefined;
  // 保留模糊搜索结果，把精确代码放在第一条供下拉组件自动高亮。
  const orderedItems =
    exactMatch && exactMatch !== items[0]
      ? [exactMatch, ...items.filter((option) => option !== exactMatch)]
      : items;
  const isOpen = remoteSearch?.open ?? open ?? localOpen;
  function changeOpen(next: boolean) {
    if (!remoteSearch && open === undefined) setLocalOpen(next);
    if (!next && prioritizeCodeMatch) setCodeQuery("");
    remoteSearch?.onOpenChange(next);
    onOpenChange?.(next);
  }

  const triggerLabel = compactTrigger ? (
    compactTrigger.label
  ) : value ? (
    <span className="truncate">{value.name}</span>
  ) : (
    <span className="truncate text-muted-foreground">{placeholder}</span>
  );
  const triggerStyles = cn(
    formDropdownStyles.chevron,
    !compactTrigger && formDropdownStyles.trigger,
    triggerClassName
  );
  const dropdownFooter = (
    <>
      {footer}
      <SelectFooter
        action={
          action && {
            label: action.label,
            onClick: () => {
              changeOpen(false);
              action.onClick();
            },
          }
        }
        onClear={
          value && onClear
            ? () => {
                onClear();
                changeOpen(false);
              }
            : undefined
        }
        disabled={disabled}
      />
    </>
  );

  if (!showSearch) {
    function openWithArrows(event: ReactKeyboardEvent<HTMLButtonElement>) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      changeOpen(true);
    }

    return (
      <Popover open={isOpen} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          {compactTrigger ? (
            <InputGroupButton
              {...triggerAria}
              id={id}
              type="button"
              role="combobox"
              aria-label={compactTrigger.ariaLabel}
              aria-required={required}
              aria-busy={busy || undefined}
              disabled={disabled}
              className={triggerStyles}
              onKeyDown={openWithArrows}
            >
              {triggerLabel}
              <ChevronDown aria-hidden="true" />
            </InputGroupButton>
          ) : (
            <Button
              {...triggerAria}
              id={id}
              type="button"
              role="combobox"
              variant="outline"
              aria-required={required}
              aria-busy={busy || undefined}
              disabled={disabled}
              className={triggerStyles}
              onKeyDown={openWithArrows}
            >
              {triggerLabel}
              <ChevronDown
                className="text-muted-foreground"
                aria-hidden="true"
              />
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          aria-label={placeholder}
          className={cn(
            "max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width) gap-0 overflow-hidden p-0",
            formDropdownStyles.popup,
            compactTrigger ? "w-64" : "w-(--radix-popover-trigger-width)"
          )}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: 分组的是弹层内可用键盘切换的选项按钮。 */}
          <div
            className={cn(
              formDropdownStyles.list,
              "max-h-72 overflow-y-auto p-1"
            )}
            role="group"
            aria-label="可选项"
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)"
                )
              );
              const index = buttons.findIndex(
                (button) => button === event.target
              );
              if (index < 0) return;
              let next: number;
              switch (event.key) {
                case "ArrowDown":
                  next = (index + 1) % buttons.length;
                  break;
                case "ArrowUp":
                  next = (index + buttons.length - 1) % buttons.length;
                  break;
                case "Home":
                  next = 0;
                  break;
                case "End":
                  next = buttons.length - 1;
                  break;
                default: {
                  if (
                    event.key.length !== 1 ||
                    event.key === " " ||
                    event.ctrlKey ||
                    event.altKey ||
                    event.metaKey
                  )
                    return;
                  const letter = event.key.toLocaleLowerCase();
                  next = buttons.findIndex((button) =>
                    button.textContent?.toLocaleLowerCase().startsWith(letter)
                  );
                  if (next < 0) return;
                }
              }
              event.preventDefault();
              buttons[next]?.focus();
            }}
          >
            {items.length === 0 && (
              <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            )}
            {items.map((option) => {
              const selected = Boolean(
                value &&
                  (getOptionKey
                    ? getOptionKey(option) === getOptionKey(value)
                    : option === value)
              );
              return (
                <Button
                  key={getOptionKey?.(option) ?? option.name}
                  type="button"
                  variant="ghost"
                  className={cn(
                    formDropdownStyles.option,
                    "w-full justify-between font-normal"
                  )}
                  disabled={isOptionDisabled?.(option)}
                  aria-pressed={selected}
                  onClick={() => {
                    onValueChange(option);
                    changeOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {renderOption(option)}
                  </span>
                  {selected && <Check aria-hidden="true" />}
                </Button>
              );
            })}
          </div>
          {dropdownFooter}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Combobox
      items={orderedItems}
      value={value}
      disabled={disabled}
      autoHighlight
      open={isOpen}
      inputValue={remoteSearch?.query}
      onOpenChange={changeOpen}
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
        if (option && !isOptionDisabled?.(option)) onValueChange(option);
      }}
    >
      <ComboboxTrigger
        {...triggerAria}
        id={id}
        aria-label={compactTrigger?.ariaLabel ?? triggerAria["aria-label"]}
        aria-required={required}
        aria-busy={busy || undefined}
        render={
          compactTrigger ? (
            <InputGroupButton />
          ) : (
            <Button type="button" variant="outline" />
          )
        }
        className={triggerStyles}
      >
        {triggerLabel}
      </ComboboxTrigger>
      <ComboboxContent
        container={container}
        sideOffset={4}
        className={cn(formDropdownStyles.popup, compactTrigger && "w-64")}
      >
        <SelectSearchInput placeholder={searchPlaceholder} />
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList showScrollbar className={formDropdownStyles.list}>
          {(option: Option) => (
            <ComboboxItem
              key={getOptionKey?.(option) ?? option.name}
              value={option}
              disabled={isOptionDisabled?.(option)}
              className={formDropdownStyles.option}
            >
              {renderOption(option)}
            </ComboboxItem>
          )}
        </ComboboxList>
        {dropdownFooter}
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
