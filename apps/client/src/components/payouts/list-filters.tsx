import { Package } from "lucide-react";
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
import type { PayoutListItem } from "@/request/payouts";
import { getProduct, listProducts, ProductApiError } from "@/request/products";

import type { PayoutListSearch } from "./navigation";

type QueryUpdater = (previous: PayoutListSearch) => PayoutListSearch;
type ProductLabel = { label: string; retryable?: boolean };
type ProductOption = { id: string; name: string; productNo: string };

const productField = {
  id: "productId",
  displayName: "产品",
  icon: Package,
  type: "option",
  flatValueOptions: true,
  accessor: (payout: PayoutListItem) => payout.productId,
} as const;
const serverRows: PayoutListItem[] = [];

const pickerLabels = {
  searchPlaceholder: "搜索产品名称或编号",
  loadingText: "正在加载产品…",
  emptyText: "没有匹配的产品",
  loadErrorText: "暂时无法加载产品。",
  labelErrorText: "所选产品加载失败",
  previousPageLabel: "上一页产品",
  nextPageLabel: "下一页产品",
  selectionLimitText: (limit: number) => `最多选择 ${limit} 个产品`,
};

async function loadProductOptions(
  query: PagedListFilterQuery,
  signal: AbortSignal
) {
  const { products, total } = await listProducts(query, signal);
  return {
    options: products.map(({ id, name, productNo }) => ({
      id,
      name,
      productNo,
    })),
    total,
  };
}

function readFilters(query: PayoutListSearch): FiltersState {
  const values = listOptionValues(query.productId);
  if (!values.length) return [];
  return [
    {
      columnId: productField.id,
      type: productField.type,
      operator:
        listOptionOperator(values.length, query.productOperator) ?? "is",
      values,
    },
  ];
}

function updateProductFilter(
  query: PayoutListSearch,
  values: string[],
  operator: unknown
): PayoutListSearch {
  if (values.length > listOptionLimit) return query;
  const nextOperator = listOptionOperator(values.length, operator);
  const previous = listOptionValues(query.productId);
  if (
    nextOperator === query.productOperator &&
    previous.length === values.length &&
    previous.every((value, index) => value === values[index])
  ) {
    return query;
  }

  return { productId: listOptionValue(values), productOperator: nextOperator };
}

export function usePayoutListFilters(
  query: PayoutListSearch,
  onQueryChange: (update: QueryUpdater) => void,
  records: PayoutListItem[] | undefined
) {
  const [labels, setLabels] = useState<ReadonlyMap<string, ProductLabel>>(
    () => new Map()
  );
  const selectedIds = useMemo(
    () => listOptionValues(query.productId),
    [query.productId]
  );
  const pageProducts = useMemo(
    () => new Map(records?.map(({ product }) => [product.id, product.name])),
    [records]
  );

  useEffect(() => {
    const missingIds = selectedIds.filter(
      (id) => !pageProducts.has(id) && !labels.has(id)
    );
    if (!missingIds.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all(
      missingIds.map(async (id): Promise<[string, ProductLabel]> => {
        try {
          const { product } = await getProduct(id, signal);
          return [id, { label: product.name }];
        } catch (error) {
          const unavailable =
            error instanceof ProductApiError && error.status === 404;
          return [
            id,
            {
              label: unavailable ? "所选产品不可用" : "所选产品加载失败",
              retryable: !unavailable,
            },
          ];
        }
      })
    ).then((next) => {
      if (!signal.aborted)
        setLabels((previous) => new Map([...previous, ...next]));
    });
    return () => controller.abort();
  }, [labels, pageProducts, selectedIds]);

  const toggleProduct = useCallback(
    ({ id, name }: ProductOption) => {
      setLabels((previous) =>
        previous.get(id)?.label === name
          ? previous
          : new Map(previous).set(id, { label: name })
      );
      onQueryChange((previous) => {
        const selected = listOptionValues(previous.productId);
        const next = selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id];
        return updateProductFilter(previous, next, previous.productOperator);
      });
    },
    [onQueryChange]
  );

  const columnsConfig = useMemo(
    () =>
      [
        {
          ...productField,
          options: selectedIds.map((id) => ({
            value: id,
            label:
              pageProducts.get(id) ?? labels.get(id)?.label ?? "正在读取产品…",
          })),
          renderFilterValue: (filter) => (
            <PagedListFilter
              loadOptions={loadProductOptions}
              labels={pickerLabels}
              searchMaxLength={256}
              selectionLimit={listOptionLimit}
              selected={filter?.values ?? []}
              labelLookupFailed={selectedIds.some(
                (id) => !pageProducts.has(id) && labels.get(id)?.retryable
              )}
              onRetryLabels={() =>
                setLabels(
                  (previous) =>
                    new Map(
                      [...previous].filter(([, label]) => !label.retryable)
                    )
                )
              }
              onToggle={toggleProduct}
              renderOption={({ name, productNo }) => (
                <>
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {productNo}
                  </span>
                </>
              )}
            />
          ),
        },
      ] satisfies ColumnConfig<PayoutListItem, "option">[],
    [labels, pageProducts, selectedIds, toggleProduct]
  );

  const filters = useMemo(() => readFilters(query), [query]);
  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) => {
      onQueryChange((previous) => {
        const next =
          typeof update === "function" ? update(readFilters(previous)) : update;
        const product = next.find(
          ({ columnId }) => columnId === productField.id
        );
        return updateProductFilter(
          previous,
          [
            ...new Set(
              product?.values.filter((value) => typeof value === "string")
            ),
          ],
          product?.operator
        );
      });
    },
    [onQueryChange]
  );

  return useDataTableFilters({
    columnsConfig,
    data: serverRows,
    strategy: "server",
    filters,
    onFiltersChange,
  });
}
