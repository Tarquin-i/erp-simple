import { cn } from "cn";
import type { ReactNode } from "react";

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

  return (
    <>
      <ListToolbar title={title} className={filterCount > 0 ? "mb-3" : "mb-5"}>
        {search}
        <FilterSelector
          {...filterModel}
          align="end"
          trigger={<ListFilterButton count={filterCount} />}
        />
        {actions}
      </ListToolbar>
      {filterCount > 0 && (
        <div
          role="group"
          aria-label={`已应用的${title}筛选`}
          className="mb-3 flex min-w-0 items-start gap-2"
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-wrap gap-2 *:h-8 *:max-w-full",
              "[&_[data-filter-part=value]]:min-w-0 [&_[data-filter-part=value]]:max-w-49 [&_[data-filter-part=value]]:shrink [&_[data-filter-part=value]]:justify-start [&_[data-filter-part=value]]:overflow-hidden",
              "[&_[data-filter-part=value]>*]:min-w-0 [&_[data-filter-part=value-label]]:truncate"
            )}
          >
            <ActiveFilters {...filterModel} />
          </div>
          <div className="flex shrink-0 [&>button]:size-8 [&>button]:bg-destructive [&>button]:text-white [&>button:hover]:bg-destructive/90 md:[&>button]:w-auto">
            <FilterActions hasFilters actions={filterModel.actions} />
          </div>
        </div>
      )}
    </>
  );
}
