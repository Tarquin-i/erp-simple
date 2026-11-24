import { Building2, Shapes } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetStateAction } from "react";

import { useDataTableFilters } from "@/components/shared/data-table-filter";
import type {
  ColumnConfig,
  FiltersState,
} from "@/components/shared/data-table-filter/core/types";
import { PagedListFilter } from "@/components/shared/paged-list-filter";
import type { PagedListFilterQuery } from "@/components/shared/paged-list-filter";
import {
  listOptionLimit,
  listOptionOperator,
  listOptionValue,
  listOptionValues,
} from "@/lib/list-option-query";
import {
  CustomerApiError,
  getCustomer,
  listCustomers,
} from "@/request/customers";
import { productTypeLabels } from "@/request/products";
import type { ProductListItem, ProductListQuery } from "@/request/products";

import { readProductListQuery } from "../navigation";

type QueryUpdater = (previous: ProductListQuery) => ProductListQuery;
type CustomerLabel = { label: string; retryable?: boolean };
type CustomerOption = { id: string; name: string; customerNo: string };

const customerField = {
  id: "customerId",
  operatorKey: "customerOperator",
  displayName: "客户",
  icon: Building2,
  type: "option",
  flatValueOptions: true,
  accessor: (product: ProductListItem) => product.customerId,
} as const;
const productTypeField = {
  id: "productTypes",
  operatorKey: "productTypeOperator",
  displayName: "产品类型",
  icon: Shapes,
  type: "option",
  flatValueOptions: true,
  accessor: (product: ProductListItem) => product.productType,
} as const;
const filterFields = [customerField, productTypeField];
const typeOptions = Object.entries(productTypeLabels).map(([value, label]) => ({
  value,
  label,
}));
const serverRows: ProductListItem[] = [];

const customerPickerLabels = {
  searchPlaceholder: "搜索客户名称或编号",
  loadingText: "正在加载客户…",
  emptyText: "没有匹配的客户",
  loadErrorText: "暂时无法加载客户。",
  labelErrorText: "所选客户加载失败",
  previousPageLabel: "上一页客户",
  nextPageLabel: "下一页客户",
  selectionLimitText: (limit: number) => `最多选择 ${limit} 个客户`,
};

async function loadCustomerOptions(
  query: PagedListFilterQuery,
  signal: AbortSignal
) {
  const { customers, total } = await listCustomers(query, signal);
  return {
    options: customers.map(({ id, companyName, customerNo }) => ({
      id,
      name: companyName,
      customerNo,
    })),
    total,
  };
}

function readFilters(query: ProductListQuery): FiltersState {
  return filterFields.flatMap(({ id, type, operatorKey }) => {
    const values = listOptionValues(query[id]);
    return values.length
      ? [
          {
            columnId: id,
            type,
            operator:
              listOptionOperator(values.length, query[operatorKey]) ?? "is",
            values,
          },
        ]
      : [];
  });
}

function applyFilters(
  query: ProductListQuery,
  update: SetStateAction<FiltersState>
) {
  const filters =
    typeof update === "function" ? update(readFilters(query)) : update;
  const next: Record<string, unknown> = { ...query };
  let changed = false;

  for (const { id, operatorKey } of filterFields) {
    const filter = filters.find(({ columnId }) => columnId === id);
    const selected = [
      ...new Set(filter?.values.filter((value) => typeof value === "string")),
    ];
    if (selected.length > listOptionLimit) continue;
    const previous = listOptionValues(query[id]);
    const operator = listOptionOperator(selected.length, filter?.operator);
    if (
      operator === query[operatorKey] &&
      previous.length === selected.length &&
      previous.every((value, index) => value === selected[index])
    )
      continue;

    changed = true;
    next[id] = listOptionValue(selected);
    next[operatorKey] = operator;
  }

  return changed ? readProductListQuery({ ...next, page: undefined }) : query;
}

/** 将产品列表的 URL 条件和客户候选接入公共筛选。 */
export function useProductListFilters(
  query: ProductListQuery,
  onQueryChange: (update: QueryUpdater) => void,
  records: ProductListItem[] | undefined
) {
  const [labels, setLabels] = useState<ReadonlyMap<string, CustomerLabel>>(
    () => new Map()
  );
  const selectedIds = useMemo(
    () => listOptionValues(query.customerId),
    [query.customerId]
  );
  const pageCustomers = useMemo(
    () =>
      new Map(
        records?.map(
          ({ customer }) => [customer.id, customer.companyName] as const
        )
      ),
    [records]
  );

  useEffect(() => {
    const missingIds = selectedIds.filter(
      (id) => !pageCustomers.has(id) && !labels.has(id)
    );
    if (!missingIds.length) return;
    const controller = new AbortController();
    void Promise.all(
      missingIds.map(async (id): Promise<[string, CustomerLabel]> => {
        try {
          const { customer } = await getCustomer(id, controller.signal);
          return [id, { label: customer.companyName }];
        } catch (error) {
          const unavailable =
            error instanceof CustomerApiError && error.status === 404;
          return [
            id,
            {
              label: unavailable ? "所选客户不可用" : "所选客户加载失败",
              retryable: !unavailable,
            },
          ];
        }
      })
    ).then((next) => {
      if (!controller.signal.aborted) {
        setLabels((previous) => new Map([...previous, ...next]));
      }
    });
    return () => controller.abort();
  }, [selectedIds, pageCustomers, labels]);

  const toggleCustomer = useCallback(
    ({ id, name }: CustomerOption) => {
      setLabels((previous) =>
        previous.get(id)?.label === name
          ? previous
          : new Map(previous).set(id, { label: name })
      );
      onQueryChange((previous) => {
        const selected = listOptionValues(previous.customerId);
        const next = selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id];
        if (next.length > listOptionLimit) return previous;
        return {
          ...previous,
          customerId: listOptionValue(next),
          customerOperator: listOptionOperator(
            next.length,
            previous.customerOperator
          ),
          page: undefined,
        };
      });
    },
    [onQueryChange]
  );

  const columnsConfig = useMemo(
    () =>
      [
        {
          ...customerField,
          options: selectedIds.map((id) => ({
            value: id,
            label:
              pageCustomers.get(id) ?? labels.get(id)?.label ?? "正在读取客户…",
          })),
          renderFilterValue: (filter) => (
            <PagedListFilter
              loadOptions={loadCustomerOptions}
              labels={customerPickerLabels}
              searchMaxLength={256}
              selectionLimit={listOptionLimit}
              selected={filter?.values ?? []}
              labelLookupFailed={selectedIds.some(
                (id) => !pageCustomers.has(id) && labels.get(id)?.retryable
              )}
              onRetryLabels={() =>
                setLabels(
                  (previous) =>
                    new Map(
                      [...previous].filter(([, label]) => !label.retryable)
                    )
                )
              }
              onToggle={toggleCustomer}
              renderOption={(customer) => (
                <>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={customer.name}
                  >
                    {customer.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {customer.customerNo}
                  </span>
                </>
              )}
            />
          ),
        },
        { ...productTypeField, options: typeOptions },
      ] satisfies ColumnConfig<ProductListItem, "option">[],
    [selectedIds, pageCustomers, labels, toggleCustomer]
  );

  const filters = useMemo(() => readFilters(query), [query]);
  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) =>
      onQueryChange((previous) => applyFilters(previous, update)),
    [onQueryChange]
  );
  return useDataTableFilters({
    columnsConfig,
    strategy: "server",
    data: serverRows,
    filters,
    onFiltersChange,
  });
}
