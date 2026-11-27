import { cn } from "cn";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ActiveFilters } from "./data-table-filter/components/active-filters";
import { FilterActions } from "./data-table-filter/components/filter-actions";
import { FilterSelector } from "./data-table-filter/components/filter-selector";
import type {
  Column,
  DataTableFilterActions,
  FilterStrategy,
  FiltersState,
} from "./data-table-filter/core/types";
import { ListFilterButton, ListToolbar } from "./list-toolbar";

export function ListFilterToolbar<TData>({
  title,
  search,
  actions,
  filterModel,
}: {
  title: string;
  search?: ReactNode;
  actions?: ReactNode;
  filterModel: {
    columns: Column<TData>[];
    filters: FiltersState;
    actions: DataTableFilterActions;
    strategy: FilterStrategy;
  };
}) {
  const filterCount = filterModel.filters.length;
  const hasFilters = filterCount > 0;
  const filterButton = useRef<HTMLButtonElement>(null);
  const appliedContent = useRef<HTMLDivElement>(null);
  const [appliedHeight, setAppliedHeight] = useState(0);

  useLayoutEffect(() => {
    const element = appliedContent.current;
    if (!element || !hasFilters) return;

    // 清除条件时，以最后测得的高度完成布局过渡。
    const measure = () =>
      setAppliedHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasFilters]);

  const appliedActions: DataTableFilterActions = {
    ...filterModel.actions,
    removeFilter(columnId) {
      filterButton.current?.focus({ preventScroll: true });
      filterModel.actions.removeFilter(columnId);
    },
    removeAllFilters() {
      filterButton.current?.focus({ preventScroll: true });
      filterModel.actions.removeAllFilters();
    },
  };

  return (
    <>
      <ListToolbar title={title} className="mb-3">
        {search}
        <FilterSelector
          {...filterModel}
          align="end"
          trigger={<ListFilterButton ref={filterButton} count={filterCount} />}
        />
        {actions}
      </ListToolbar>
      <div
        className={cn(
          "grid pb-2 transition-[grid-template-rows,opacity] duration-160 ease-out motion-reduce:transition-none",
          hasFilters
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0 min-w-0 overflow-clip [overflow-clip-margin:4px]">
          <div
            ref={appliedContent}
            className={hasFilters ? "pb-1" : undefined}
            style={hasFilters ? undefined : { height: appliedHeight }}
          >
            {hasFilters && (
              <section
                aria-label={`已应用的${title}筛选`}
                className="flex min-w-0 items-start gap-2"
              >
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-wrap gap-2 *:h-8 *:max-w-full",
                    "**:data-[filter-part=value]:min-w-0 **:data-[filter-part=value]:max-w-49 **:data-[filter-part=value]:shrink **:data-[filter-part=value]:justify-start **:data-[filter-part=value]:overflow-hidden",
                    "[&_[data-filter-part=value]>*]:min-w-0 **:data-[filter-part=value-label]:truncate"
                  )}
                >
                  <ActiveFilters {...filterModel} actions={appliedActions} />
                </div>
                <div className="flex shrink-0 [&>button]:size-8 [&>button]:bg-destructive [&>button]:text-white [&>button:hover]:bg-destructive/90 md:[&>button]:w-auto">
                  <FilterActions hasFilters actions={appliedActions} />
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
