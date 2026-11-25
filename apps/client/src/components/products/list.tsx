import { Link } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ListFilterToolbar } from "@/components/shared/list-filter-toolbar";
import { ListSearchInput } from "@/components/shared/list-toolbar";
import { ListPagination } from "@/components/shared/list-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  tableLinkClassName,
  TableRow,
} from "@/components/ui/table";
import { listProducts, productTypeLabels } from "@/request/products";
import type { ProductListQuery } from "@/request/products";

import { useProductListFilters } from "./list/filters";
import type { productListOrigin } from "./navigation";

type ProductPage = Awaited<ReturnType<typeof listProducts>>;
type QueryUpdater = (previous: ProductListQuery) => ProductListQuery;
type ListState = {
  query: ProductListQuery;
  result?: ProductPage;
  error?: string;
};

const columns = ["产品名称", "产品编号", "产品类型", "客户名称", "创建时间"];
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

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
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

      {current?.error ? (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyTitle>产品列表加载失败</EmptyTitle>
            <EmptyDescription>{current.error}</EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoad(undefined);
              setRetry((attempt) => attempt + 1);
            }}
          >
            重试
          </Button>
        </Empty>
      ) : !result || result.page > pageCount ? (
        <div role="status">
          <span className="sr-only">正在加载产品…</span>
          <ProductTable>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <TableRow aria-hidden="true" key={rowIndex}>
                {columns.map((column) => (
                  <TableCell className="h-11" key={column}>
                    <Skeleton className="h-4 w-24 max-w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </ProductTable>
        </div>
      ) : result.products.length === 0 ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              className="size-12 shrink-0 rounded-xl border bg-background shadow-xs [&_svg]:size-6"
            >
              <Package />
            </EmptyMedia>
            <EmptyTitle className="text-xl font-semibold">
              {query.search || filterModel.filters.length
                ? "没有找到符合条件的产品"
                : "暂无产品"}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ProductTable>
            {result.products.map((product) => (
              <TableRow
                className="cursor-pointer"
                key={product.id}
                onClick={(event) => {
                  if (
                    event.defaultPrevented ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    event.altKey ||
                    window.getSelection()?.toString() ||
                    (event.target instanceof Element &&
                      event.target.closest("a"))
                  ) {
                    return;
                  }
                  onOpenProduct(product.id);
                }}
              >
                <TableCell className="max-w-0 py-3">
                  <Link
                    className={tableLinkClassName}
                    to="/products/$productId"
                    params={{ productId: product.id }}
                    state={listOrigin}
                    title={product.name}
                  >
                    {product.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {product.productNo}
                </TableCell>
                <TableCell className="max-w-0">
                  <Badge variant="secondary" className="max-w-full">
                    <span className="truncate">
                      {product.customerDefinedType ??
                        productTypeLabels[product.productType]}
                    </span>
                  </Badge>
                </TableCell>
                <TableCell className="max-w-0">
                  <Link
                    className={tableLinkClassName}
                    to="/customers/$customerId"
                    params={{ customerId: product.customer.id }}
                    title={product.customer.companyName}
                  >
                    {product.customer.companyName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  <time dateTime={product.createdAt}>
                    {dateTime.format(new Date(product.createdAt))}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </ProductTable>
          <ListPagination
            label="产品列表分页"
            page={result.page}
            pageCount={pageCount}
            total={result.total}
            className="mt-5"
            onPageChange={(page) =>
              onQueryChange((previous) => ({
                ...previous,
                page: page > 1 ? page : undefined,
              }))
            }
          />
        </>
      )}
    </main>
  );
}

function ProductTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-160 table-fixed border-b">
      <TableCaption className="sr-only">产品列表</TableCaption>
      <colgroup>
        <col className="w-[24%]" />
        <col className="w-[13%]" />
        <col className="w-[14%]" />
        <col className="w-[27%]" />
        <col className="w-[22%]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className="text-muted-foreground" key={column}>
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
