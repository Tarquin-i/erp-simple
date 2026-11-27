import { type HistoryState, Link } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE } from "@/components/products/navigation";
import { ListEmptyState } from "@/components/shared/list-empty-state";
import { ListLoadError } from "@/components/shared/list-load-error";
import { ListPagination } from "@/components/shared/list-pagination";
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
import { LIST_PAGE_SIZES } from "@/lib/list-page-size";
import {
  listProducts,
  type ProductPage,
  productTypeLabels,
} from "@/request/products";

const columns = ["产品编号", "产品名称", "产品类型", "创建时间"] as const;
const pageSizeOptions = [
  DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE,
  ...LIST_PAGE_SIZES,
];
const pendingRows = Array.from(
  { length: DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE },
  (_, index) => index
);
const creationDate = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type ProductLoad = { customerId: string; page: number; pageSize: number } & (
  | { result: ProductPage; error?: undefined }
  | { result?: undefined; error: string }
);

function CustomerProductTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-md table-fixed border-b">
      <TableCaption className="sr-only">客户产品列表</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column}
              scope="col"
              className="text-muted-foreground"
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

export function CustomerProductsTab({
  customerId,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onOpenProduct,
  productLinkState,
}: {
  customerId: string;
  page: number;
  pageSize: number;
  onPageChange: (page: number, replace?: boolean) => void;
  onPageSizeChange: (size: number) => void;
  onOpenProduct: (productId: string) => void;
  productLinkState?: HistoryState;
}) {
  const [load, setLoad] = useState<ProductLoad>();
  const [retry, setRetry] = useState(0);
  const current =
    load?.customerId === customerId &&
    load.page === page &&
    load.pageSize === pageSize
      ? load
      : undefined;
  const loadedPage = current?.result;
  const pageCount = loadedPage
    ? Math.max(1, Math.ceil(loadedPage.total / loadedPage.pageSize))
    : 1;
  const result =
    loadedPage && loadedPage.page <= pageCount ? loadedPage : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies(retry): 重试时重新加载当前客户的产品页。
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listProducts({ customerId, page, pageSize }, signal).then(
      (result) => {
        if (!signal.aborted) setLoad({ customerId, page, pageSize, result });
      },
      (error: unknown) => {
        if (!signal.aborted) {
          setLoad({
            customerId,
            page,
            pageSize,
            error: error instanceof Error ? error.message : "请稍后重试。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [customerId, page, pageSize, retry]);

  useEffect(() => {
    if (loadedPage && loadedPage.page > pageCount)
      onPageChange(pageCount, true);
  }, [loadedPage, pageCount, onPageChange]);

  if (current?.error) {
    return (
      <ListLoadError
        title="暂时无法加载产品"
        message={current.error}
        onRetry={() => {
          setLoad(undefined);
          setRetry((attempt) => attempt + 1);
        }}
      />
    );
  }

  if (result?.products.length === 0) {
    return <ListEmptyState icon={<Package />} title="暂无产品" />;
  }

  const table = (
    <CustomerProductTable>
      {result
        ? result.products.map((product) => (
            <TableRow
              key={product.id}
              className="cursor-pointer"
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey ||
                  window.getSelection()?.toString() ||
                  (event.target instanceof Element && event.target.closest("a"))
                ) {
                  return;
                }
                onOpenProduct(product.id);
              }}
            >
              <TableCell className="h-11.25 truncate tabular-nums">
                {product.productNo}
              </TableCell>
              <TableCell className="max-w-0">
                <Link
                  to="/products/$productId"
                  params={{ productId: product.id }}
                  state={productLinkState}
                  preload={false}
                  className={tableLinkClassName}
                  title={product.name}
                >
                  {product.name}
                </Link>
              </TableCell>
              <TableCell className="truncate">
                {product.customerDefinedType ??
                  productTypeLabels[product.productType]}
              </TableCell>
              <TableCell className="tabular-nums">
                <time dateTime={product.createdAt}>
                  {creationDate.format(new Date(product.createdAt))}
                </time>
              </TableCell>
            </TableRow>
          ))
        : pendingRows.slice(0, pageSize).map((row) => (
            <TableRow key={row} aria-hidden="true">
              {columns.map((column) => (
                <TableCell key={column} className="h-11.25">
                  <Skeleton className="h-4 w-24 max-w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
    </CustomerProductTable>
  );

  return (
    <>
      {result ? (
        table
      ) : (
        <div aria-busy="true" aria-label="正在加载产品" role="status">
          {table}
        </div>
      )}
      <ListPagination
        label="客户产品分页"
        result={result}
        className="mt-5"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={pageSizeOptions}
      />
    </>
  );
}
