import { useEffect, useState } from "react";

import { SearchableSelect } from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import { listProducts } from "@/request/products";
import type { ProductListItem } from "@/request/products";

export type PayoutProductChoice = Pick<
  ProductListItem,
  "id" | "name" | "productNo" | "currencyCode"
>;

type ProductLookup = {
  keyword: string;
  page: number;
  total: number;
  products: PayoutProductChoice[];
};

const lookupPageSize = 20;

export function PayoutProductPicker({
  id,
  value,
  disabled,
  required,
  onChange,
}: {
  id: string;
  value: PayoutProductChoice | null;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: PayoutProductChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [lookup, setLookup] = useState<ProductLookup>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const keyword = search.trim();
  const result = lookup?.keyword === keyword ? lookup : undefined;
  const loading = !error && result?.page !== page;

  // biome-ignore lint/correctness/useExhaustiveDependencies(retry): 重试时重新查询当前页的产品候选。
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(
      () => {
        void listProducts(
          { search: keyword, page, pageSize: lookupPageSize },
          signal
        )
          .then(({ products, total }) => {
            if (signal.aborted) return;
            setLookup((previous) => ({
              keyword,
              page,
              total,
              products:
                page > 1 && previous?.keyword === keyword
                  ? [
                      ...new Map(
                        [...previous.products, ...products].map((product) => [
                          product.id,
                          product,
                        ])
                      ).values(),
                    ]
                  : products,
            }));
          })
          .catch((failure: unknown) => {
            if (!signal.aborted) {
              setError(
                failure instanceof Error ? failure.message : "产品加载失败。"
              );
            }
          });
      },
      page === 1 && keyword ? 250 : 0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, open, page, retry]);

  const canLoadMore = result && result.page * lookupPageSize < result.total;

  return (
    <SearchableSelect
      id={id}
      items={result?.products ?? []}
      value={value}
      placeholder={required ? "搜索并选择产品" : "选择产品"}
      searchPlaceholder="搜索产品名称或编号"
      emptyMessage={error || (loading ? "正在加载产品…" : "没有匹配的产品")}
      disabled={disabled}
      required={required}
      remoteSearch={{
        open,
        query: search,
        onOpenChange: (next) => {
          setOpen(next);
          if (!next) {
            setSearch("");
            setLookup(undefined);
            setError("");
            setPage(1);
          }
        },
        onQueryChange: (next) => {
          setSearch(next);
          if (next.trim() !== keyword) {
            setLookup(undefined);
            setError("");
            setPage(1);
          }
        },
      }}
      getOptionKey={(product) => product.id}
      renderOption={(product) => (
        <>
          <span className="min-w-0 flex-1 truncate" title={product.name}>
            {product.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {product.productNo}
          </span>
        </>
      )}
      footer={
        error || canLoadMore ? (
          <div className="shrink-0 border-t p-1">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={loading}
              onClick={() => {
                if (error) {
                  setError("");
                  setRetry((attempt) => attempt + 1);
                } else if (result) {
                  setPage(result.page + 1);
                }
              }}
            >
              {error ? "重试加载产品" : loading ? "正在加载…" : "加载更多产品"}
            </Button>
          </div>
        ) : null
      }
      onValueChange={onChange}
    />
  );
}
