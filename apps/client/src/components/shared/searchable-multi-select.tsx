import { cn } from "cn";
import { ChevronDown, Pencil, X } from "lucide-react";
import { type ReactNode, type Ref, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { FieldLabel } from "@/components/ui/field";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  type DropdownAction,
  SelectFooter,
  SelectSearchInput,
  formDropdownStyles,
} from "./select-popup-parts";
import { hasVisibleTagColor, TagColorDot } from "./tag-color-dot";

type MultiSelectOption = { id: string; name: string };

type SearchableMultiSelectProps<Option extends MultiSelectOption> = {
  id: string;
  label: string;
  items: readonly Option[];
  value: Option[];
  onChange: (value: Option[]) => void;
  disabled?: boolean;
  emptyMessage: string;
  descriptionId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  search?: {
    placeholder: string;
    query?: string;
    onQueryChange?: (value: string) => void;
  };
  isOptionDisabled?: (option: Option) => boolean;
  getOptionColor?: (option: Option) => string | undefined;
  onEditOptionColor?: (option: Option) => void;
  allowClear?: boolean;
  action?: DropdownAction;
  footer?: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
};

export function SearchableMultiSelect<Option extends MultiSelectOption>({
  id,
  label,
  items,
  value,
  onChange,
  disabled,
  emptyMessage,
  descriptionId,
  open,
  onOpenChange,
  search,
  isOptionDisabled,
  getOptionColor,
  onEditOptionColor,
  allowClear,
  action,
  footer,
  triggerRef,
}: SearchableMultiSelectProps<Option>) {
  const anchor = useComboboxAnchor();
  const popup = useRef<HTMLDivElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const visibleChips = value.slice(0, 2);
  const remainingCount = value.length - visibleChips.length;
  const selectionDescriptionId = value.length ? `${id}-selection` : undefined;

  function changeOpen(next: boolean) {
    if (open === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  }

  function focusTrigger() {
    anchor.current
      ?.querySelector<HTMLButtonElement>("[data-form-multi-trigger]")
      ?.focus({ preventScroll: true });
  }

  function removeOption(optionId: string) {
    if (!disabled) onChange(value.filter((option) => option.id !== optionId));
  }

  function clearSelection() {
    if (disabled) return;
    const target = popup.current?.querySelector<HTMLElement>(
      search ? "input" : '[role="checkbox"]:not(:disabled)'
    );
    (target ?? popup.current)?.focus({ preventScroll: true });
    onChange([]);
  }

  const triggerProps = {
    id,
    ref: triggerRef,
    type: "button" as const,
    "aria-label": `打开${label}选项`,
    "aria-describedby":
      [descriptionId, selectionDescriptionId].filter(Boolean).join(" ") ||
      undefined,
    "data-form-multi-trigger": "",
    disabled,
    // 块级排列避免占位文字清除后因基线变化而移动触发器。
    className: cn(
      "flex",
      formDropdownStyles.trigger,
      formDropdownStyles.chevron
    ),
  };
  const triggerContent = (
    <span className="truncate text-muted-foreground" aria-hidden="true">
      {!value.length ? `选择${label}` : ""}
    </span>
  );
  const chips = value.length > 0 && (
    <>
      <span id={selectionDescriptionId} className="sr-only">
        已选 {value.length} 项。
        {visibleChips.map(({ name }) => name).join("、")}
      </span>
      <div className="pointer-events-none absolute inset-y-0 right-9 left-2.5 flex min-w-0 items-center gap-1">
        {visibleChips.map((option) => {
          const color = getOptionColor?.(option);
          const showColor = hasVisibleTagColor(color);
          return (
            <Badge
              key={option.id}
              variant={showColor ? "outline" : "default"}
              className={cn(
                "min-w-0 shrink pr-0",
                showColor ? "gap-1" : "gap-0.5"
              )}
            >
              <TagColorDot color={color} />
              <span className="truncate">{option.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "pointer-events-auto size-[18px] rounded-full border-0 text-inherit opacity-80 hover:text-inherit hover:opacity-100",
                  showColor
                    ? "hover:bg-muted focus-visible:ring-ring"
                    : "hover:bg-primary-foreground/15 focus-visible:ring-primary-foreground/70"
                )}
                aria-label={`移除${option.name}`}
                disabled={disabled}
                onClick={() => {
                  focusTrigger();
                  removeOption(option.id);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </Badge>
          );
        })}
        {remainingCount > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            +{remainingCount}
          </span>
        )}
      </div>
    </>
  );
  const panelFooter = (
    <>
      {footer}
      <SelectFooter
        disabled={disabled}
        action={
          action && {
            label: action.label,
            onClick: () => {
              changeOpen(false);
              action.onClick();
            },
          }
        }
        onClear={allowClear && value.length ? clearSelection : undefined}
      />
    </>
  );

  if (search) {
    const optionsList = (
      <ComboboxList
        showScrollbar
        className={cn(
          formDropdownStyles.list,
          onEditOptionColor && "max-h-none overflow-visible pr-0"
        )}
      >
        {(option: Option) => (
          <ComboboxItem
            key={option.id}
            value={option}
            disabled={isOptionDisabled?.(option)}
            className={formDropdownStyles.option}
          >
            <TagColorDot color={getOptionColor?.(option)} />
            <span className="min-w-0 truncate">{option.name}</span>
          </ComboboxItem>
        )}
      </ComboboxList>
    );

    return (
      <Combobox
        multiple
        items={items}
        value={value}
        disabled={disabled}
        autoHighlight
        open={isOpen}
        filter={
          search.query !== undefined || search.onQueryChange ? null : undefined
        }
        inputValue={search.query}
        itemToStringLabel={(option) => option.name}
        isItemEqualToValue={(option, selected) => option.id === selected.id}
        onOpenChange={(next, details) => {
          if (!next && details.reason === "item-press") {
            details.cancel();
            return;
          }
          changeOpen(next);
        }}
        onInputValueChange={(query, details) => {
          if (details.isItemPress) details.cancel();
          else if (details.reason === "input-change")
            search.onQueryChange?.(query);
        }}
        onValueChange={(next, details) => {
          if (disabled || details.reason === "escape-key") details.cancel();
          else onChange(next);
        }}
      >
        <div ref={anchor} className="relative min-w-0">
          <ComboboxTrigger
            render={<Button type="button" variant="outline" />}
            {...triggerProps}
          >
            {triggerContent}
          </ComboboxTrigger>
          {chips}
        </div>
        <ComboboxContent
          ref={popup}
          anchor={anchor}
          sideOffset={4}
          className={formDropdownStyles.popup}
        >
          <SelectSearchInput placeholder={search.placeholder} maxLength={64} />
          <ComboboxEmpty className="shrink-0">{emptyMessage}</ComboboxEmpty>
          {onEditOptionColor ? (
            <div className="grid min-h-0 max-h-60 grid-cols-[minmax(0,1fr)_auto] overflow-y-auto overscroll-contain scrollbar-thin">
              {optionsList}
              {/* 改色按钮与候选同列滚动，但在 listbox 外，可独立聚焦。 */}
              <div className="flex flex-col py-1 pr-1 empty:p-0">
                {items.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    aria-label={`修改「${option.name}」的颜色`}
                    title="修改标签颜色"
                    disabled={disabled}
                    onClick={() => onEditOptionColor(option)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            optionsList
          )}
          {panelFooter}
        </ComboboxContent>
      </Combobox>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={changeOpen}>
      <PopoverAnchor asChild>
        <div ref={anchor} className="relative min-w-0">
          <PopoverTrigger asChild>
            <Button variant="outline" {...triggerProps}>
              {triggerContent}
              <ChevronDown
                aria-hidden="true"
                className="text-muted-foreground"
              />
            </Button>
          </PopoverTrigger>
          {chips}
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={popup}
        tabIndex={-1}
        aria-label={`${label}选项`}
        align="start"
        className={cn(
          "max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) gap-0 overflow-hidden p-0",
          formDropdownStyles.popup
        )}
      >
        <div className="max-h-72 min-h-0 overflow-y-auto overscroll-contain p-1 scrollbar-thin">
          {items.length === 0 && (
            <p className="px-2 py-1.5 text-muted-foreground">{emptyMessage}</p>
          )}
          {items.map((option, index) => {
            const optionId = `${id}-option-${index}`;
            const checked = value.some((selected) => selected.id === option.id);
            return (
              <FieldLabel
                key={option.id}
                htmlFor={optionId}
                className={cn(
                  formDropdownStyles.option,
                  "w-full min-w-0 cursor-pointer gap-2 rounded-md pr-2 font-normal has-[[data-state=checked]]:bg-primary/5 hover:bg-accent focus-within:bg-accent"
                )}
              >
                <Checkbox
                  id={optionId}
                  checked={checked}
                  disabled={disabled || isOptionDisabled?.(option)}
                  onCheckedChange={(next) => {
                    if (disabled || isOptionDisabled?.(option)) return;
                    if (next) onChange([...value, option]);
                    else removeOption(option.id);
                  }}
                />
                <TagColorDot color={getOptionColor?.(option)} />
                <span className="min-w-0 truncate">{option.name}</span>
              </FieldLabel>
            );
          })}
        </div>
        {panelFooter}
      </PopoverContent>
    </Popover>
  );
}
