import {
  FilterMenuAutoFocus,
  FilterMenuCheckbox,
  FilterMenuCommand,
  FilterMenuContent,
  FilterMenuSearch,
} from "@/components/shared/filter-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, FilterIcon } from "lucide-react";
import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import React from "react";
import type { PointerEvent } from "react";
import type {
  Column,
  ColumnDataType,
  DataTableFilterActions,
  FilterModel,
  FilterStrategy,
  FiltersState,
  OptionBasedColumnDataType,
} from "../core/types";
import { isAnyOf } from "../lib/array";
import { getColumn } from "../lib/helpers";
import { type Locale, t } from "../lib/i18n";
import { FilterValueController } from "./filter-value";

interface FilterSelectorProps<TData> {
  filters: FiltersState;
  columns: Column<TData>[];
  actions: DataTableFilterActions;
  strategy: FilterStrategy;
  locale?: Locale;
  trigger?: React.ReactElement;
  align?: "start" | "center" | "end";
}

type HoveredField = {
  id: string;
  anchor: HTMLDivElement;
  side: "left" | "right";
};

export const FilterSelector = memo(
  FilterSelectorImpl
) as typeof FilterSelectorImpl;

function FilterSelectorImpl<TData>({
  filters,
  columns,
  actions,
  strategy,
  locale = "en",
  trigger,
  align = "start",
}: FilterSelectorProps<TData>) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [property, setProperty] = useState<string | undefined>(undefined);
  const [hoveredField, setHoveredField] = useState<HoveredField>();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldMenuRef = useRef<HTMLDivElement>(null);
  const valueMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>(undefined);
  const allowSideFocus = useRef(false);

  const column = property ? getColumn(columns, property) : undefined;
  const filter = property
    ? filters.find((f) => f.columnId === property)
    : undefined;

  const hasFilters = filters.length > 0;
  const flat = columns.some((column) => column.flatValueOptions);
  const MenuCommand = flat ? FilterMenuCommand : Command;
  const MenuSearch = flat ? FilterMenuSearch : CommandInput;
  const hoveredColumn = hoveredField && getColumn(columns, hoveredField.id);
  const hoveredFilter =
    hoveredField &&
    filters.find(({ columnId }) => columnId === hoveredField.id);

  useEffect(() => {
    if (property && inputRef) {
      inputRef.current?.focus();
      setValue("");
    }
  }, [property]);

  const cancelHoverTimer = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => cancelHoverTimer, [cancelHoverTimer]);

  function openSideMenu(id: string, event: PointerEvent<HTMLDivElement>) {
    if (!flat || event.pointerType !== "mouse") return;
    cancelHoverTimer();
    if (hoveredField?.id === id) return;
    const anchor = event.currentTarget;
    hoverTimer.current = window.setTimeout(() => {
      const menu = fieldMenuRef.current?.getBoundingClientRect();
      if (!menu || !anchor.isConnected) return;
      // 预留侧面间距以及视口边缘空间。空间不足时沿用点击打开候选的方式。
      const requiredSpace = menu.width + 16;
      const side =
        menu.left >= requiredSpace
          ? "left"
          : document.documentElement.clientWidth - menu.right >= requiredSpace
            ? "right"
            : undefined;
      if (valueMenuRef.current?.contains(document.activeElement)) {
        inputRef.current?.focus({ preventScroll: true });
      }
      allowSideFocus.current = false;
      setHoveredField(side ? { id, anchor, side } : undefined);
    }, 100);
  }

  function scheduleCloseSideMenu(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    cancelHoverTimer();
    // 鼠标经过两块面板之间的间隙时，仍可进入候选菜单。
    hoverTimer.current = window.setTimeout(() => {
      if (!valueMenuRef.current?.contains(document.activeElement)) {
        setHoveredField(undefined);
      }
    }, 160);
  }

  function selectField(id: string) {
    cancelHoverTimer();
    const valueInput =
      hoveredField?.id === id
        ? valueMenuRef.current?.querySelector<HTMLInputElement>(
            '[data-slot="command-input"]'
          )
        : undefined;
    if (valueInput) {
      allowSideFocus.current = true;
      valueInput.focus({ preventScroll: true });
      return;
    }
    setHoveredField(undefined);
    setProperty(id);
  }

  const content =
    property && column ? (
      <FilterValueController
        filter={filter}
        column={column as Column<TData, ColumnDataType>}
        actions={actions}
        strategy={strategy}
        locale={locale}
      />
    ) : (
      <MenuCommand
        loop
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            cancelHoverTimer();
            setHoveredField(undefined);
          }
        }}
        filter={(value, search, keywords) => {
          const extendValue = `${value} ${keywords?.join(" ")}`;
          return extendValue.toLowerCase().includes(search.toLowerCase())
            ? 1
            : 0;
        }}
      >
        <MenuSearch
          value={value}
          onValueChange={(nextValue) => {
            cancelHoverTimer();
            setHoveredField(undefined);
            setValue(nextValue);
          }}
          ref={inputRef}
          placeholder={t("search", locale)}
        />
        <CommandEmpty>{t("noresults", locale)}</CommandEmpty>
        <CommandList className={flat ? undefined : "max-h-fit"}>
          <CommandGroup>
            {columns.map((column) => (
              <FilterableColumn
                key={column.id}
                column={column}
                setProperty={selectField}
                onHover={openSideMenu}
                onLeave={scheduleCloseSideMenu}
                showSubmenu={flat}
                submenuOpen={hoveredField && hoveredField.id === column.id}
              />
            ))}
            <QuickSearchFilters
              search={value}
              filters={filters}
              columns={columns}
              actions={actions}
            />
          </CommandGroup>
        </CommandList>
      </MenuCommand>
    );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        cancelHoverTimer();
        setHoveredField(undefined);
        if (nextOpen) {
          setValue("");
          setProperty(undefined);
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            className={cn("h-7", hasFilters && "w-fit px-2!")}
          >
            <FilterIcon className="size-4" />
            {!hasFilters && <span>{t("filter", locale)}</span>}
          </Button>
        )}
      </PopoverTrigger>
      <FilterMenuContent
        ref={fieldMenuRef}
        flat={flat}
        align={align}
        side="bottom"
        onInteractOutside={(event) => {
          if (
            event.target instanceof Node &&
            valueMenuRef.current?.contains(event.target)
          ) {
            event.preventDefault();
          }
        }}
      >
        {content}
        {open && hoveredField && hoveredColumn && (
          <Popover open onOpenChange={() => setHoveredField(undefined)}>
            <PopoverAnchor virtualRef={{ current: hoveredField.anchor }} />
            <FilterMenuContent
              ref={valueMenuRef}
              flat
              aria-label={hoveredColumn.displayName}
              side={hoveredField.side}
              align="start"
              sideOffset={7}
              onPointerEnter={cancelHoverTimer}
              onPointerLeave={scheduleCloseSideMenu}
              onPointerDownCapture={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("input,button")
                ) {
                  allowSideFocus.current = true;
                }
              }}
              onFocusCapture={(event) => {
                // cmdk moves focus to its own input when highlighting a candidate.
                if (
                  !allowSideFocus.current &&
                  event.relatedTarget === inputRef.current
                ) {
                  inputRef.current?.focus({ preventScroll: true });
                }
              }}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (
                  event.target instanceof Node &&
                  fieldMenuRef.current?.contains(event.target)
                ) {
                  event.preventDefault();
                }
              }}
              onEscapeKeyDown={() =>
                inputRef.current?.focus({ preventScroll: true })
              }
            >
              <FilterMenuAutoFocus value={false}>
                <FilterValueController
                  key={hoveredField.id}
                  filter={hoveredFilter}
                  column={hoveredColumn as Column<TData, ColumnDataType>}
                  actions={actions}
                  strategy={strategy}
                  locale={locale}
                />
              </FilterMenuAutoFocus>
            </FilterMenuContent>
          </Popover>
        )}
      </FilterMenuContent>
    </Popover>
  );
}

export function FilterableColumn<TData, TType extends ColumnDataType, TVal>({
  column,
  setProperty,
  onHover,
  onLeave,
  showSubmenu,
  submenuOpen,
}: {
  column: Column<TData, TType, TVal>;
  setProperty: (value: string) => void;
  onHover: (id: string, event: PointerEvent<HTMLDivElement>) => void;
  onLeave: (event: PointerEvent<HTMLDivElement>) => void;
  showSubmenu: boolean;
  submenuOpen?: boolean;
}) {
  const itemRef = useRef<HTMLDivElement>(null);

  const prefetch = useCallback(() => {
    column.prefetchOptions();
    column.prefetchValues();
    column.prefetchFacetedUniqueValues();
    column.prefetchFacetedMinMaxValues();
  }, [column]);

  useEffect(() => {
    const target = itemRef.current;

    if (!target) return;

    // Set up MutationObserver
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const isSelected = target.getAttribute("data-selected") === "true";
          if (isSelected) prefetch();
        }
      }
    });

    // Set up observer
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-selected"],
    });

    // Cleanup on unmount
    return () => observer.disconnect();
  }, [prefetch]);

  return (
    <CommandItem
      ref={itemRef}
      value={column.id}
      keywords={[column.displayName]}
      onSelect={() => setProperty(column.id)}
      onMouseEnter={prefetch}
      onPointerEnter={(event) => onHover(column.id, event)}
      onPointerLeave={onLeave}
      aria-haspopup={showSubmenu ? "dialog" : undefined}
      data-submenu-open={submenuOpen || undefined}
      className={cn(
        showSubmenu && "[&>svg:last-child]:hidden",
        submenuOpen && "bg-muted",
        submenuOpen === false && "data-selected:bg-transparent"
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        <column.icon strokeWidth={2.25} className="size-4" />
        <span>{column.displayName}</span>
        {showSubmenu && (
          <ChevronRightIcon
            aria-hidden
            className="ml-auto size-4 text-muted-foreground"
          />
        )}
      </div>
    </CommandItem>
  );
}

interface QuickSearchFiltersProps<TData> {
  search?: string;
  filters: FiltersState;
  columns: Column<TData>[];
  actions: DataTableFilterActions;
}

export const QuickSearchFilters = memo(
  __QuickSearchFilters
) as typeof __QuickSearchFilters;

function __QuickSearchFilters<TData>({
  search,
  filters,
  columns,
  actions,
}: QuickSearchFiltersProps<TData>) {
  if (!search || search.trim().length < 2) return null;

  const cols = columns.filter(
    (column): column is Column<TData, OptionBasedColumnDataType> =>
      isAnyOf<ColumnDataType>(column.type, ["option", "multiOption"])
  );

  return (
    <>
      {cols.map((column) => {
        const filter = filters.find(
          (f): f is FilterModel<OptionBasedColumnDataType> =>
            f.columnId === column.id && f.type === column.type
        );
        const options = column.getOptions();
        const optionsCount = column.getFacetedUniqueValues();

        function handleOptionSelect(value: string, check: boolean) {
          if (check) actions.addFilterValue(column, [value]);
          else actions.removeFilterValue(column, [value]);
        }

        return (
          <React.Fragment key={column.id}>
            {options.map((v) => {
              const checked = Boolean(filter?.values.includes(v.value));
              const count = optionsCount?.get(v.value);

              return (
                <CommandItem
                  key={v.value}
                  value={v.value}
                  keywords={[v.label, v.value]}
                  onSelect={() => {
                    handleOptionSelect(v.value, !checked);
                  }}
                  className="group"
                  aria-checked={column.flatValueOptions ? checked : undefined}
                >
                  <div className="flex items-center gap-1.5 group">
                    {column.flatValueOptions ? (
                      <FilterMenuCheckbox checked={checked} />
                    ) : (
                      <Checkbox
                        checked={checked}
                        className="opacity-0 data-[state=checked]:opacity-100 group-data-[selected=true]:opacity-100 dark:border-ring mr-1"
                      />
                    )}
                    <div className="flex items-center w-4 justify-center">
                      {v.icon &&
                        (isValidElement(v.icon) ? (
                          v.icon
                        ) : (
                          <v.icon className="size-4 text-primary" />
                        ))}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <span className="text-muted-foreground">
                        {column.displayName}
                      </span>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground/75" />
                      <span>
                        {v.label}
                        <sup
                          className={cn(
                            count == null && "hidden",
                            "ml-0.5 tabular-nums tracking-tight text-muted-foreground",
                            count === 0 && "slashed-zero"
                          )}
                        >
                          {typeof count === "number"
                            ? count < 100
                              ? count
                              : "100+"
                            : ""}
                        </sup>
                      </span>
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}
