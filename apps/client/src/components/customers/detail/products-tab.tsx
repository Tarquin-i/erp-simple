import { type HistoryState, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { CustomerPagination } from "@/components/customers/pagination";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
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
import {
  listProducts,
  type ProductPage,
  productTypeLabels,
} from "@/request/products";

const columns = ["产品编号", "产品名称", "产品类型", "创建时间"] as const;
const pageSize = 5;
const pendingRows = Array.from({ length: pageSize }, (_, index) => index);
const creationDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type ProductLoad = { customerId: string; page: number } & (
  | { result: ProductPage; error?: undefined }
  | { result?: undefined; error: string }
);

function CustomerProductTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-[28rem] table-fixed border-b">
      <TableCaption className="sr-only">客户产品列表</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column}
              scope="col"
              className="px-2.5 text-muted-foreground"
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
  onPageChange,
  onOpenProduct,
  productLinkState,
}: {
  customerId: string;
  page: number;
  onPageChange: (page: number, replace?: boolean) => void;
  onOpenProduct: (productId: string) => void;
  productLinkState?: HistoryState;
}) {
  const [load, setLoad] = useState<ProductLoad>();
  const [retry, setRetry] = useState(0);
  const current =
    load?.customerId === customerId && load.page === page ? load : undefined;
  const result = current?.result;
  const pageCount = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listProducts({ customerId, page, pageSize }, signal).then(
      (result) => {
        if (!signal.aborted) setLoad({ customerId, page, result });
      },
      (error: unknown) => {
        if (!signal.aborted) {
          setLoad({
            customerId,
            page,
            error: error instanceof Error ? error.message : "请稍后重试。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [customerId, page, retry]);

  useEffect(() => {
    if (result && result.page > pageCount) onPageChange(pageCount, true);
  }, [result, pageCount, onPageChange]);

  if (current?.error) {
    return (
      <Empty className="min-h-52 border">
        <EmptyHeader>
          <EmptyTitle>暂时无法加载产品</EmptyTitle>
          <EmptyDescription role="alert">{current.error}</EmptyDescription>
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
    );
  }

  if (!result || result.page > pageCount) {
    return (
      <div aria-busy="true" aria-label="正在加载产品" role="status">
        <CustomerProductTable>
          {pendingRows.map((row) => (
            <TableRow key={row} aria-hidden="true">
              {columns.map((column) => (
                <TableCell key={column} className="h-14 px-2.5">
                  <Skeleton className="h-4 w-24 max-w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </CustomerProductTable>
      </div>
    );
  }

  if (result.products.length === 0) {
    return (
      <Empty className="min-h-52 border">
        <EmptyHeader>
          <EmptyTitle>暂无产品</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <CustomerProductTable>
        {result.products.map((product) => (
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
            <TableCell className="h-14 truncate px-2.5 tabular-nums">
              {product.productNo}
            </TableCell>
            <TableCell className="max-w-0 px-2.5">
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
            <TableCell className="truncate px-2.5">
              {product.customerDefinedType ??
                productTypeLabels[product.productType]}
            </TableCell>
            <TableCell className="px-2.5 tabular-nums">
              <time dateTime={product.createdAt}>
                {creationDate.format(new Date(product.createdAt))}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </CustomerProductTable>
      <CustomerPagination
        label="客户产品分页"
        page={result.page}
        pageCount={pageCount}
        total={result.total}
        className="mt-4"
        onPageChange={onPageChange}
      />
    </>
  );
}
