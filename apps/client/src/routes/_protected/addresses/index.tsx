import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { MapPin, Plus, Search } from "lucide-react";
import type { FormEvent } from "react";

import {
  AddressPageError,
  AddressPagePending,
} from "@/components/addresses/load-state";
import { readAddressListQuery } from "@/components/addresses/navigation";
import { AddressPhoneValue } from "@/components/addresses/phone-value";
import { CustomerPagination } from "@/components/customers/pagination";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listDefaultAddresses } from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/")({
  validateSearch: readAddressListQuery,
  loaderDeps: ({ search }) => search,
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ deps, abortController }) => {
      const signal = abortController.signal;
      const result = await listDefaultAddresses(deps, signal);
      const last = Math.max(1, Math.ceil(result.total / result.pageSize));
      return result.page > last
        ? listDefaultAddresses({ ...deps, page: last }, signal)
        : result;
    },
  },
  pendingComponent: AddressPagePending,
  // 搜索和翻页时立即替换旧结果，避免从正在刷新的目录打开旧地址。
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: ({ error }) => <AddressPageError error={error} />,
  component: AddressDirectory,
});

/** 默认地址目录，保留搜索和页码供返回列表时恢复。 */
function AddressDirectory() {
  const navigate = Route.useNavigate();
  const query = Route.useSearch();
  const { addresses, page, pageSize, total } = Route.useLoaderData();
  const loadingDirectory = useRouterState({
    select: ({ isLoading, location, resolvedLocation }) =>
      isLoading && location.pathname === resolvedLocation?.pathname,
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("search");
    void navigate({
      search: readAddressListQuery({ search: value }),
      resetScroll: false,
    });
  }

  // 再次提交相同搜索条件时，路由仍挂在当前匹配上。
  if (loadingDirectory) return <AddressPagePending />;

  return (
    <main className="min-w-0 flex-1 space-y-5 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">地址</h1>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={search} className="flex items-center gap-2">
            <Input
              key={query.search ?? ""}
              name="search"
              type="search"
              aria-label="搜索地址"
              placeholder="客户名称、编号或收货人"
              defaultValue={query.search ?? ""}
              maxLength={128}
              className="min-w-0 sm:w-56"
            />
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" />
              搜索
            </Button>
            {query.search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void navigate({ search: {}, resetScroll: false })
                }
              >
                清除
              </Button>
            )}
          </form>
          <Button asChild>
            <Link
              to="/addresses/new"
              search={{}}
              state={{ addressListQuery: query }}
              preload={false}
            >
              <Plus aria-hidden="true" />
              新建地址
            </Link>
          </Button>
        </div>
      </header>

      {addresses.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyTitle>
              {query.search ? "没有匹配的地址" : "暂无默认地址"}
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
              {addresses.map((address) => {
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
                    <TableCell
                      className="truncate py-3"
                      title={address.customer.companyName}
                    >
                      {address.customer.companyName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {address.customer.customerNo}
                    </TableCell>
                    <TableCell>
                      <Link
                        {...destination}
                        preload={false}
                        title={address.formattedAddress}
                        className="block w-fit max-w-full truncate rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
            page={page}
            pageCount={Math.max(1, Math.ceil(total / pageSize))}
            total={total}
            onPageChange={(next) =>
              void navigate({
                search: { ...query, page: next > 1 ? next : undefined },
              })
            }
          />
        </>
      )}
    </main>
  );
}
