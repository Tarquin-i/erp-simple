"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { createColumns } from "../core/filters";
import {
  DEFAULT_OPERATORS,
  determineNewOperator,
  filterTypeOperatorDetails,
} from "../core/operators";
import type {
  ColumnConfig,
  ColumnDataType,
  ColumnOption,
  DataTableFilterActions,
  FilterModel,
  FilterStrategy,
  FilterValues,
  FiltersState,
  NumberColumnIds,
  OptionBasedColumnDataType,
  OptionColumnIds,
  TableColumnConfig,
} from "../core/types";
import { uniq } from "../lib/array";
import { addUniq, removeUniq } from "../lib/array";
import {
  createDateFilterValue,
  createNumberFilterValue,
  isColumnOptionArray,
  isColumnOptionMap,
  isMinMaxTuple,
} from "../lib/helpers";

const normalizeFilterValues: {
  [Type in ColumnDataType]: (values: FilterValues<Type>) => FilterValues<Type>;
} = {
  text: uniq,
  number: createNumberFilterValue,
  date: createDateFilterValue,
  option: uniq,
  multiOption: uniq,
};

function findFilter<Type extends ColumnDataType>(
  filters: FiltersState,
  columnId: string,
  type: Type
) {
  return filters.find(
    (filter): filter is FilterModel<Type> =>
      filter.columnId === columnId && filter.type === type
  );
}

export interface DataTableFiltersOptions<
  TData,
  TColumns extends ReadonlyArray<TableColumnConfig<TData>>,
  TStrategy extends FilterStrategy,
> {
  strategy: TStrategy;
  data: TData[];
  columnsConfig: TColumns;
  defaultFilters?: FiltersState;
  filters?: FiltersState;
  onFiltersChange?: React.Dispatch<React.SetStateAction<FiltersState>>;
  options?: Partial<
    Record<OptionColumnIds<TColumns>, ColumnOption[] | undefined>
  >;
  faceted?: Partial<
    Record<OptionColumnIds<TColumns>, Map<string, number> | undefined> &
      Record<NumberColumnIds<TColumns>, [number, number] | undefined>
  >;
}

export function useDataTableFilters<
  TData,
  TColumns extends ReadonlyArray<TableColumnConfig<TData>>,
  TStrategy extends FilterStrategy,
>({
  strategy,
  data,
  columnsConfig,
  defaultFilters,
  filters: externalFilters,
  onFiltersChange,
  options,
  faceted,
}: DataTableFiltersOptions<TData, TColumns, TStrategy>) {
  const [internalFilters, setInternalFilters] = useState<FiltersState>(
    defaultFilters ?? []
  );

  if (
    (externalFilters && !onFiltersChange) ||
    (!externalFilters && onFiltersChange)
  ) {
    throw new Error(
      "If using controlled state, you must specify both filters and onFiltersChange."
    );
  }

  const filters = externalFilters ?? internalFilters;
  const setFilters = onFiltersChange ?? setInternalFilters;

  // Convert ColumnConfig to Column, applying options and faceted options if provided
  const columns = useMemo(() => {
    const enhancedConfigs = columnsConfig.map((config) => {
      let final = config;

      // Set options, if exists
      if (
        options &&
        (config.type === "option" || config.type === "multiOption")
      ) {
        const optionsInput = options[config.id as OptionColumnIds<TColumns>];
        if (!optionsInput || !isColumnOptionArray(optionsInput)) return config;

        final = { ...final, options: optionsInput };
      }

      // Set faceted options, if exists
      if (
        faceted &&
        (config.type === "option" || config.type === "multiOption")
      ) {
        const facetedOptionsInput =
          faceted[config.id as OptionColumnIds<TColumns>];
        if (!facetedOptionsInput || !isColumnOptionMap(facetedOptionsInput))
          return config;

        final = { ...final, facetedOptions: facetedOptionsInput };
      }

      // Set faceted min/max values, if exists
      if (config.type === "number" && faceted) {
        const minMaxTuple = faceted[config.id as NumberColumnIds<TColumns>];
        if (!minMaxTuple || !isMinMaxTuple(minMaxTuple)) return config;

        final = {
          ...final,
          min: minMaxTuple[0],
          max: minMaxTuple[1],
        };
      }

      return final;
    });

    return createColumns(data, enhancedConfigs, strategy);
  }, [data, columnsConfig, options, faceted, strategy]);

  const actions: DataTableFilterActions = useMemo(
    () => ({
      addFilterValue<TData, TType extends OptionBasedColumnDataType>(
        column: ColumnConfig<TData, TType>,
        values: FilterModel<TType>["values"]
      ) {
        if (column.type === "option") {
          setFilters((prev) => {
            const filter = findFilter(prev, column.id, "option");
            const isColumnFiltered = filter && filter.values.length > 0;
            if (!isColumnFiltered) {
              return [
                ...prev,
                {
                  columnId: column.id,
                  type: "option",
                  operator:
                    values.length > 1
                      ? DEFAULT_OPERATORS.option.multiple
                      : DEFAULT_OPERATORS.option.single,
                  values,
                },
              ];
            }
            const oldValues = filter.values;
            const newValues = addUniq(filter.values, values);
            const newOperator = determineNewOperator(
              "option",
              oldValues,
              newValues,
              filter.operator
            );
            return prev.map((f) =>
              f.columnId === column.id
                ? {
                    columnId: column.id,
                    type: "option",
                    operator: newOperator,
                    values: newValues,
                  }
                : f
            );
          });
          return;
        }
        if (column.type === "multiOption") {
          setFilters((prev) => {
            const filter = findFilter(prev, column.id, "multiOption");
            const isColumnFiltered = filter && filter.values.length > 0;
            if (!isColumnFiltered) {
              return [
                ...prev,
                {
                  columnId: column.id,
                  type: "multiOption",
                  operator:
                    values.length > 1
                      ? DEFAULT_OPERATORS.multiOption.multiple
                      : DEFAULT_OPERATORS.multiOption.single,
                  values,
                },
              ];
            }
            const oldValues = filter.values;
            const newValues = addUniq(filter.values, values);
            const newOperator = determineNewOperator(
              "multiOption",
              oldValues,
              newValues,
              filter.operator
            );
            if (newValues.length === 0) {
              return prev.filter((f) => f.columnId !== column.id);
            }
            return prev.map((f) =>
              f.columnId === column.id
                ? {
                    columnId: column.id,
                    type: "multiOption",
                    operator: newOperator,
                    values: newValues,
                  }
                : f
            );
          });
          return;
        }
        throw new Error(
          "[data-table-filter] addFilterValue() is only supported for option columns"
        );
      },
      removeFilterValue<TData, TType extends OptionBasedColumnDataType>(
        column: ColumnConfig<TData, TType>,
        value: FilterModel<TType>["values"]
      ) {
        if (column.type === "option") {
          setFilters((prev) => {
            const filter = findFilter(prev, column.id, "option");
            const isColumnFiltered = filter && filter.values.length > 0;
            if (!isColumnFiltered) {
              return [...prev];
            }
            const newValues = removeUniq(filter.values, value);
            const oldValues = filter.values;
            const newOperator = determineNewOperator(
              "option",
              oldValues,
              newValues,
              filter.operator
            );
            if (newValues.length === 0) {
              return prev.filter((f) => f.columnId !== column.id);
            }
            return prev.map((f) =>
              f.columnId === column.id
                ? {
                    columnId: column.id,
                    type: "option",
                    operator: newOperator,
                    values: newValues,
                  }
                : f
            );
          });
          return;
        }
        if (column.type === "multiOption") {
          setFilters((prev) => {
            const filter = findFilter(prev, column.id, "multiOption");
            const isColumnFiltered = filter && filter.values.length > 0;
            if (!isColumnFiltered) {
              return [...prev];
            }
            const newValues = removeUniq(filter.values, value);
            const oldValues = filter.values;
            const newOperator = determineNewOperator(
              "multiOption",
              oldValues,
              newValues,
              filter.operator
            );
            if (newValues.length === 0) {
              return prev.filter((f) => f.columnId !== column.id);
            }
            return prev.map((f) =>
              f.columnId === column.id
                ? {
                    columnId: column.id,
                    type: "multiOption",
                    operator: newOperator,
                    values: newValues,
                  }
                : f
            );
          });
          return;
        }
        throw new Error(
          "[data-table-filter] removeFilterValue() is only supported for option columns"
        );
      },
      setFilterValue<TData, TType extends ColumnDataType>(
        column: ColumnConfig<TData, TType>,
        values: FilterValues<TType>
      ) {
        setFilters((prev) => {
          const filter = findFilter(prev, column.id, column.type);
          const newValues = normalizeFilterValues[column.type](values);
          if (newValues.length === 0) return prev;
          const isColumnFiltered = filter && filter.values.length > 0;
          const operator = isColumnFiltered
            ? determineNewOperator(
                column.type,
                filter.values,
                newValues,
                filter.operator
              )
            : DEFAULT_OPERATORS[column.type][
                values.length > 1 ? "multiple" : "single"
              ];
          const newFilter = {
            columnId: column.id,
            type: column.type,
            operator,
            values: newValues,
          } as FilterModel<TType>;
          return isColumnFiltered
            ? prev.map((f) => (f.columnId === column.id ? newFilter : f))
            : [...prev, newFilter];
        });
      },
      setFilterOperator<TType extends ColumnDataType>(
        columnId: string,
        operator: FilterModel<TType>["operator"]
      ) {
        setFilters((prev) =>
          prev.map((filter) =>
            filter.columnId === columnId &&
            Object.hasOwn(filterTypeOperatorDetails[filter.type], operator)
              ? ({ ...filter, operator } as FilterModel)
              : filter
          )
        );
      },
      removeFilter(columnId: string) {
        setFilters((prev) => prev.filter((f) => f.columnId !== columnId));
      },
      removeAllFilters() {
        setFilters([]);
      },
    }),
    [setFilters]
  );

  return { columns, filters, actions, strategy }; // columns is Column<TData>[]
}
