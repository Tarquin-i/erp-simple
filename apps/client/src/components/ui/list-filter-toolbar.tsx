import type { ReactNode } from "react";

import {
  ActiveFilters,
  ActiveFiltersMobileContainer,
} from "@/components/data-table-filter/components/active-filters";
import { FilterActions } from "@/components/data-table-filter/components/filter-actions";
import { FilterSelector } from "@/components/data-table-filter/components/filter-selector";
import type {
  Column,
  DataTableFilterActions,
  FilterStrategy,
  FiltersState,
} from "@/components/data-table-filter/core/types";
import { ListFilterButton, ListToolbar } from "@/components/ui/list-toolbar";

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
      <ListToolbar title={title} className="mb-5">
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
          className="mb-4 flex min-w-0 items-center gap-2"
        >
          <ActiveFiltersMobileContainer>
            <ActiveFilters {...filterModel} />
          </ActiveFiltersMobileContainer>
          <div className="ml-auto shrink-0 [&>button]:bg-destructive [&>button]:text-white [&>button:hover]:bg-destructive/90">
            <FilterActions hasFilters actions={filterModel.actions} />
          </div>
        </div>
      )}
    </>
  );
}
