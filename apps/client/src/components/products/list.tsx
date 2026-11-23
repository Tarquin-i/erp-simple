import { Link } from "@tanstack/react-router";
import { Filter, Package, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { CustomerPagination } from "@/components/customers/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { keepDialogOpenOnComboboxEscape } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProducts, productTypeLabels } from "@/request/products";
import type { ProductListQuery } from "@/request/products";

import { ProductListFilters } from "./list/filters";
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterContainer, setFilterContainer] = useState<HTMLDivElement | null>(
    null
  );
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
  const filterCount =
    Number(Boolean(query.customerId)) +
    Number(Boolean(query.productTypes?.length)) +
    Number(query.sortDirection === "asc");
  const selectedCustomer = result?.products.find(
    ({ customerId }) => customerId === query.customerId
  )?.customer;

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">
          产品
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="h-10 w-56 max-w-full sm:w-80">
            <InputGroupInput
              type="search"
              aria-label="搜索产品"
              placeholder="搜索产品名称、编号或客户"
              maxLength={256}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                className="h-10 gap-2 px-4"
                variant={filterCount ? "secondary" : "outline"}
                aria-label={
                  filterCount ? `筛选，已应用 ${filterCount} 项` : "筛选"
                }
              >
                <Filter data-icon="inline-start" />
                筛选
                {filterCount > 0 && (
                  <Badge variant="outline" className="size-5 p-0 tabular-nums">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              ref={setFilterContainer}
              align="end"
              sideOffset={8}
              aria-label="产品筛选"
              className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0"
              onEscapeKeyDown={(event) =>
                keepDialogOpenOnComboboxEscape(event, filterContainer)
              }
            >
              {filterOpen && (
                <ProductListFilters
                  filters={{
                    customerId: query.customerId,
                    productTypes: query.productTypes,
                    sortDirection: query.sortDirection,
                  }}
                  selectedCustomer={selectedCustomer}
                  container={filterContainer}
                  onApply={(filters) => {
                    setFilterOpen(false);
                    const types = filters.productTypes ?? [];
                    if (
                      filters.customerId === query.customerId &&
                      (filters.sortDirection ?? "desc") ===
                        (query.sortDirection ?? "desc") &&
                      types.length === (query.productTypes?.length ?? 0) &&
                      types.every((type) => query.productTypes?.includes(type))
                    ) {
                      return;
                    }
                    onQueryChange((previous) => ({
                      ...previous,
                      customerId: filters.customerId,
                      productTypes: filters.productTypes,
                      sortDirection: filters.sortDirection,
                      page: undefined,
                    }));
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          {canCreate && (
            <Button asChild className="h-10 px-4">
              <Link to="/products/new" state={listOrigin} aria-label="新建产品">
                <Plus data-icon="inline-start" />
                新建
              </Link>
            </Button>
          )}
        </div>
      </div>

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
                  <TableCell className="h-14 px-2.5" key={column}>
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
              {query.search || filterCount
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
                <TableCell className="h-14 max-w-0 px-2.5">
                  <Link
                    className="block w-fit max-w-full truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    to="/products/$productId"
                    params={{ productId: product.id }}
                    state={listOrigin}
                    title={product.name}
                  >
                    {product.name}
                  </Link>
                </TableCell>
                <TableCell className="px-2.5 tabular-nums">
                  {product.productNo}
                </TableCell>
                <TableCell className="max-w-0 px-2.5">
                  <Badge variant="secondary" className="max-w-full">
                    <span className="truncate">
                      {product.customerDefinedType ??
                        productTypeLabels[product.productType]}
                    </span>
                  </Badge>
                </TableCell>
                <TableCell className="max-w-0 px-2.5">
                  <Link
                    className="block w-fit max-w-full truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    to="/customers/$customerId"
                    params={{ customerId: product.customer.id }}
                    title={product.customer.companyName}
                  >
                    {product.customer.companyName}
                  </Link>
                </TableCell>
                <TableCell className="px-2.5 text-muted-foreground tabular-nums">
                  <time dateTime={product.createdAt}>
                    {dateTime.format(new Date(product.createdAt))}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </ProductTable>
          <CustomerPagination
            label="产品列表分页"
            page={result.page}
            pageCount={pageCount}
            total={result.total}
            className="mt-4"
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
        <col className="w-[26%]" />
        <col className="w-[15%]" />
        <col className="w-[16%]" />
        <col className="w-[25%]" />
        <col className="w-[18%]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              className="h-10 px-2.5 text-muted-foreground"
              key={column}
            >
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
