import { Link } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ListEmptyState } from "@/components/shared/list-empty-state";
import { ListFilterToolbar } from "@/components/shared/list-filter-toolbar";
import { ListPage } from "@/components/shared/list-page";
import { ListSearchInput } from "@/components/shared/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tableLinkClassName } from "@/components/ui/table";
import { shouldOpenTableRow } from "@/lib/should-open-table-row";
import { listProducts, productTypeLabels } from "@/request/products";
import type { ProductListItem, ProductListQuery } from "@/request/products";

import { useProductListFilters } from "./list/filters";
import type { productListOrigin } from "./navigation";

type ProductPage = Awaited<ReturnType<typeof listProducts>>;
type QueryUpdater = (previous: ProductListQuery) => ProductListQuery;
type ListState = {
  query: ProductListQuery;
  result?: ProductPage;
  error?: string;
};

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
});

export function ProductList({
  canCreate = true,
  query,
  listOrigin,
  onQueryChange,
  onPageCorrection,
  onOpenProduct,
}: {
  canCreate?: boolean;
  query: ProductListQuery;
  listOrigin: ReturnType<typeof productListOrigin>;
  onQueryChange: (update: QueryUpdater, replace?: boolean) => void;
  onPageCorrection: (page: number) => void;
  onOpenProduct: (id: string) => void;
}) {
  const [load, setLoad] = useState<ListState>();
  const [retry, setRetry] = useState(0);
  const search = query.search ?? "";
  const [searchDraft, setSearchDraft] = useState(search);
  const lastSubmittedSearch = useRef<string | undefined>(undefined);
  const trimmedSearch = searchDraft.trim();
  const current =
    load?.query === query && trimmedSearch === search ? load : undefined;
  const result = current?.result;
  const pageCount = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;
  const visiblePage = result && result.page <= pageCount ? result : undefined;
  const filterModel = useProductListFilters(
    query,
    onQueryChange,
    load?.result?.products
  );

  useEffect(() => {
    const submitted = lastSubmittedSearch.current;
    lastSubmittedSearch.current = undefined;
    if (submitted !== search) setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (trimmedSearch === search) return;
    const timer = window.setTimeout(() => {
      lastSubmittedSearch.current = trimmedSearch;
      onQueryChange(
        (previous) => ({
          ...previous,
          search: trimmedSearch || undefined,
          page: undefined,
        }),
        true
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [trimmedSearch, search, onQueryChange]);

  useEffect(() => {
    const controller = new AbortController();
    void listProducts(query, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoad({ query, result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            query,
            error:
              error instanceof Error ? error.message : "暂时无法加载产品列表。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [query, retry]);

  useEffect(() => {
    if (!result || result.page <= pageCount) return;
    onPageCorrection(pageCount);
  }, [result, pageCount, onPageCorrection]);

  const columns: DataTableColumn<ProductListItem>[] = [
    {
      id: "name",
      header: "产品名称",
      widthClassName: "w-[24%]",
      cellClassName: "max-w-0 py-3",
      renderCell: (product) => (
        <Link
          className={tableLinkClassName}
          to="/products/$productId"
          params={{ productId: product.id }}
          state={listOrigin}
          title={product.name}
        >
          {product.name}
        </Link>
      ),
    },
    {
      id: "productNo",
      header: "产品编号",
      widthClassName: "w-[13%]",
      cellClassName: "tabular-nums",
      renderCell: (product) => product.productNo,
    },
    {
      id: "productType",
      header: "产品类型",
      widthClassName: "w-[14%]",
      cellClassName: "max-w-0",
      renderCell: (product) => (
        <Badge variant="secondary" className="max-w-full">
          <span className="truncate">
            {product.customerDefinedType ??
              productTypeLabels[product.productType]}
          </span>
        </Badge>
      ),
    },
    {
      id: "customer",
      header: "客户名称",
      widthClassName: "w-[27%]",
      cellClassName: "max-w-0",
      renderCell: (product) => (
        <Link
          className={tableLinkClassName}
          to="/customers/$customerId"
          params={{ customerId: product.customer.id }}
          title={product.customer.companyName}
        >
          {product.customer.companyName}
        </Link>
      ),
    },
    {
      id: "createdAt",
      header: "创建时间",
      widthClassName: "w-[22%]",
      cellClassName: "text-muted-foreground tabular-nums",
      renderCell: (product) => (
        <time dateTime={product.createdAt}>
          {dateTime.format(new Date(product.createdAt))}
        </time>
      ),
    },
  ];

  return (
    <ListPage>
      <ListFilterToolbar
        title="产品"
        filterModel={filterModel}
        search={
          <ListSearchInput
            aria-label="搜索产品"
            placeholder="名称、编号或客户"
            maxLength={256}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        }
        actions={
          canCreate && (
            <Button asChild size="icon">
              <Link
                to="/products/new"
                state={listOrigin}
                aria-label="新建产品"
                title="新建产品"
              >
                <Plus aria-hidden="true" />
              </Link>
            </Button>
          )
        }
      />

      <DataTable
        label="产品列表"
        minWidthClassName="min-w-160"
        columns={columns}
        rows={visiblePage?.products}
        getRowId={(product) => product.id}
        getRowProps={(product) => ({
          className: "cursor-pointer",
          onClick(event) {
            if (shouldOpenTableRow(event)) onOpenProduct(product.id);
          },
        })}
        loading={{ label: "正在加载产品…", rowCount: 6 }}
        emptyState={
          <ListEmptyState
            icon={<Package />}
            variant="prominent"
            mediaClassName="[&_svg]:size-6"
            title={
              query.search || filterModel.filters.length
                ? "没有找到符合条件的产品"
                : "暂无产品"
            }
          />
        }
        error={
          current?.error
            ? {
                title: "产品列表加载失败",
                description: current.error,
                onRetry() {
                  setLoad(undefined);
                  setRetry((attempt) => attempt + 1);
                },
              }
            : undefined
        }
        pagination={
          visiblePage
            ? {
                label: "产品列表分页",
                page: visiblePage.page,
                pageCount,
                total: visiblePage.total,
                onPageChange: (page) =>
                  onQueryChange((previous) => ({
                    ...previous,
                    page: page > 1 ? page : undefined,
                  })),
              }
            : undefined
        }
      />
    </ListPage>
  );
}
