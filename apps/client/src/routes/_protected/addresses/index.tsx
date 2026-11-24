import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { MapPin, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useAddressListFilters } from "@/components/addresses/list-filters";
import { readAddressListQuery } from "@/components/addresses/navigation";
import { AddressPhoneValue } from "@/components/addresses/phone-value";
import { ListFilterToolbar } from "@/components/shared/list-filter-toolbar";
import { ListSearchInput } from "@/components/shared/list-toolbar";
import { CustomerPagination } from "@/components/shared/pagination";
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
  TableCell,
  TableHead,
  TableHeader,
  tableLinkClassName,
  TableRow,
} from "@/components/ui/table";
import { AddressApiError, listDefaultAddresses } from "@/request/addresses";
import type { AddressListQuery } from "@/request/addresses";

type QueryUpdater = (previous: AddressListQuery) => AddressListQuery;
type DirectoryPage = Awaited<ReturnType<typeof listDefaultAddresses>>;
type DirectoryLoad = { query: AddressListQuery } & (
  | { status: "loaded"; result: DirectoryPage }
  | { status: "failed"; error: unknown }
);

export const Route = createFileRoute("/_protected/addresses/")({
  validateSearch: readAddressListQuery,
  component: AddressDirectory,
});

/** 默认地址目录，保留搜索、筛选和页码供返回列表时恢复。 */
function AddressDirectory() {
  const navigate = Route.useNavigate();
  const query = Route.useSearch();
  const [load, setLoad] = useState<DirectoryLoad>();
  const [retry, setRetry] = useState(0);
  const loadingDirectory = useRouterState({
    select: ({ isLoading, location, resolvedLocation }) =>
      isLoading && location.pathname === resolvedLocation?.pathname,
  });
  const current = !loadingDirectory && load?.query === query ? load : undefined;
  const updateQuery = useCallback(
    (update: QueryUpdater) =>
      void navigate({ search: update, resetScroll: false }),
    [navigate]
  );
  const filterModel = useAddressListFilters(query, updateQuery);

  // 条件变化时只替换结果区，保留工具栏和筛选浮层，避免旧地址在刷新中仍可点击。
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listDefaultAddresses(query, signal)
      .then((result) => {
        const last = Math.max(1, Math.ceil(result.total / result.pageSize));
        return result.page > last
          ? listDefaultAddresses({ ...query, page: last }, signal)
          : result;
      })
      .then(
        (result) => {
          if (!signal.aborted) setLoad({ status: "loaded", query, result });
        },
        (error: unknown) => {
          if (!signal.aborted) setLoad({ status: "failed", query, error });
        }
      );
    return () => controller.abort();
  }, [query, retry]);

  function reload() {
    setLoad(undefined);
    setRetry((attempt) => attempt + 1);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("search");
    const next = readAddressListQuery({
      ...query,
      search: value,
      page: undefined,
    });
    if (next.search === query.search && query.page === undefined) {
      reload();
    } else {
      updateQuery(() => next);
    }
  }

  const result = current?.status === "loaded" ? current.result : undefined;

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <ListFilterToolbar
        title="地址"
        filterModel={filterModel}
        search={
          <form onSubmit={search} className="flex min-w-0 items-center gap-2">
            <ListSearchInput
              key={query.search ?? ""}
              name="search"
              aria-label="搜索地址"
              placeholder="客户、编号或收货人"
              defaultValue={query.search ?? ""}
              maxLength={128}
            />
            <Button
              type="submit"
              size="icon"
              variant="outline"
              aria-label="搜索"
              title="搜索"
            >
              <Search aria-hidden="true" />
            </Button>
            {query.search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  updateQuery((previous) => ({
                    ...previous,
                    search: undefined,
                    page: undefined,
                  }))
                }
              >
                清除
              </Button>
            )}
          </form>
        }
        actions={
          <Button asChild size="icon">
            <Link
              to="/addresses/new"
              search={{}}
              state={{ addressListQuery: query }}
              preload={false}
              aria-label="新建地址"
              title="新建地址"
            >
              <Plus aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {current?.status === "failed" ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyTitle>暂时无法加载地址</EmptyTitle>
            <EmptyDescription role="alert">
              {current.error instanceof Error
                ? current.error.message
                : "请稍后重试。"}
            </EmptyDescription>
          </EmptyHeader>
          {!(
            current.error instanceof AddressApiError &&
            [403, 404].includes(current.error.status)
          ) && (
            <Button variant="outline" onClick={reload}>
              重试
            </Button>
          )}
        </Empty>
      ) : !result ? (
        <div role="status">
          <span className="sr-only">正在加载地址</span>
          <Skeleton className="h-36 w-full" />
        </div>
      ) : result.addresses.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyTitle>
              {query.search || query.ownerUserId
                ? "没有匹配的地址"
                : "暂无默认地址"}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table
            aria-label="默认地址列表"
            className="min-w-[640px] table-fixed"
          >
            <TableHeader>
              <TableRow>
                <TableHead className="w-[21%]">客户名称</TableHead>
                <TableHead className="w-[13%]">客户编号</TableHead>
                <TableHead className="w-[34%]">收货地址</TableHead>
                <TableHead className="w-[14%]">收货人</TableHead>
                <TableHead className="w-[18%]">联系电话</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.addresses.map((address) => {
                const destination = {
                  to: "/addresses/$addressId" as const,
                  params: { addressId: address.id },
                  search: {},
                  state: { addressListQuery: query },
                };

                return (
                  <TableRow
                    key={address.id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (
                        event.defaultPrevented ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey ||
                        window.getSelection()?.toString() ||
                        !(event.target instanceof Element) ||
                        !event.currentTarget.contains(event.target) ||
                        event.target.closest("a,button,[role='button']")
                      )
                        return;
                      void navigate(destination);
                    }}
                  >
                    <TableCell className="py-3">
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: address.customer.id }}
                        preload={false}
                        title={address.customer.companyName}
                        className={tableLinkClassName}
                      >
                        {address.customer.companyName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {address.customer.customerNo}
                    </TableCell>
                    <TableCell>
                      <Link
                        {...destination}
                        preload={false}
                        title={address.formattedAddress}
                        className={tableLinkClassName}
                      >
                        {address.formattedAddress}
                      </Link>
                    </TableCell>
                    <TableCell
                      className="truncate"
                      title={address.recipientName}
                    >
                      {address.recipientName}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <AddressPhoneValue phone={address.phone} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <CustomerPagination
            label="地址目录分页"
            page={result.page}
            pageCount={Math.max(1, Math.ceil(result.total / result.pageSize))}
            total={result.total}
            className="mt-5"
            onPageChange={(page) =>
              updateQuery((previous) => ({
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
