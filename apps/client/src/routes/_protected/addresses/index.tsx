import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import { MapPin, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useAddressListFilters } from "@/components/addresses/list-filters";
import { readAddressListQuery } from "@/components/addresses/navigation";
import { AddressPhoneValue } from "@/components/addresses/phone-value";
import { ListEmptyState } from "@/components/core/data-table/list-empty-state";
import { ListFilterToolbar } from "@/components/core/data-table/list-filter-toolbar";
import { ListPage } from "@/components/core/data-table/list-page";
import { ListPagination } from "@/components/core/data-table/list-pagination";
import { ListSearchInput } from "@/components/core/data-table/list-toolbar";
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
import { readListPageSize } from "@/lib/list-page-size";
import { shouldOpenTableRow } from "@/lib/should-open-table-row";
import { AddressApiError, listDefaultAddresses } from "@/request/addresses";
import type { AddressListQuery } from "@/request/addresses";

type QueryUpdater = (previous: AddressListQuery) => AddressListQuery;
type DirectoryPage = Awaited<ReturnType<typeof listDefaultAddresses>>;
type DirectoryLoad = { query: AddressListQuery } & (
  | { status: "loaded"; result: DirectoryPage }
  | { status: "failed"; error: unknown }
);

const columns = [
  { label: "客户名称", width: "w-[21%]" },
  { label: "客户编号", width: "w-[13%]" },
  { label: "收货地址", width: "w-[34%]" },
  { label: "收货人", width: "w-[14%]" },
  { label: "联系电话", width: "w-[18%]" },
];
const pendingRows = Array.from({ length: 5 }, (_, rowId) => rowId);

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
  const searchTerm = query.search ?? "";
  const [searchDraft, setSearchDraft] = useState(searchTerm);
  const [composing, setComposing] = useState(false);
  const lastSubmittedSearch = useRef<string | undefined>(undefined);
  const searchTimer = useRef<number | undefined>(undefined);
  const normalizedSearch = readAddressListQuery({ search: searchDraft }).search;
  const loadingDirectory = useRouterState({
    select: ({ isLoading, location, resolvedLocation }) =>
      isLoading && location.pathname === resolvedLocation?.pathname,
  });
  const current = !loadingDirectory && load?.query === query ? load : undefined;
  const updateQuery = useCallback(
    (update: QueryUpdater, replace?: boolean) =>
      void navigate({ search: update, replace, resetScroll: false }),
    [navigate]
  );
  const filterModel = useAddressListFilters(query, updateQuery);

  const applySearch = useCallback(
    (value: string | undefined, replace?: boolean) => {
      window.clearTimeout(searchTimer.current);
      lastSubmittedSearch.current = value ?? "";
      updateQuery(
        (previous) => ({ ...previous, search: value, page: undefined }),
        replace
      );
    },
    [updateQuery]
  );

  useEffect(() => {
    const submitted = lastSubmittedSearch.current;
    lastSubmittedSearch.current = undefined;
    if (submitted !== searchTerm) setSearchDraft(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    if (composing || (normalizedSearch ?? "") === searchTerm) return;
    const timer = window.setTimeout(
      () => applySearch(normalizedSearch, true),
      300
    );
    searchTimer.current = timer;
    return () => window.clearTimeout(timer);
  }, [applySearch, composing, normalizedSearch, searchTerm]);

  // 条件变化时只替换结果区，保留工具栏和筛选浮层，避免旧地址在刷新中仍可点击。
  // biome-ignore lint/correctness/useExhaustiveDependencies(retry): 重试时按同一查询条件重新加载地址列表。
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listDefaultAddresses(query, signal).then(
      (result) => {
        if (!signal.aborted) setLoad({ status: "loaded", query, result });
      },
      (error: unknown) => {
        if (!signal.aborted) setLoad({ status: "failed", query, error });
      }
    );
    return () => controller.abort();
  }, [query, retry]);

  const loadedPage = current?.status === "loaded" ? current.result : undefined;
  const pageCount = loadedPage
    ? Math.max(1, Math.ceil(loadedPage.total / loadedPage.pageSize))
    : 1;
  const result =
    loadedPage && loadedPage.page <= pageCount ? loadedPage : undefined;

  useEffect(() => {
    if (!loadedPage || loadedPage.page <= pageCount) return;
    updateQuery(
      (previous) => ({
        ...previous,
        page: pageCount > 1 ? pageCount : undefined,
      }),
      true
    );
  }, [loadedPage, pageCount, updateQuery]);

  function reload() {
    setLoad(undefined);
    setRetry((attempt) => attempt + 1);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing) return;
    if (normalizedSearch === query.search && query.page === undefined) {
      reload();
    } else {
      applySearch(normalizedSearch);
    }
  }

  return (
    <ListPage>
      <ListFilterToolbar
        title="地址"
        filterModel={filterModel}
        search={
          <form onSubmit={search} className="flex min-w-0 items-center gap-2">
            <ListSearchInput
              name="search"
              aria-label="搜索地址"
              placeholder="客户、编号或收货人"
              maxLength={128}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
            {query.search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchDraft("");
                  applySearch(undefined);
                }}
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
        <Empty className="min-h-56 border">
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
          <AddressTable>
            {pendingRows.map((rowId) => (
              <TableRow aria-hidden="true" key={rowId}>
                {columns.map(({ label }) => (
                  <TableCell className="h-11" key={label}>
                    <Skeleton className="h-4 w-24 max-w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </AddressTable>
        </div>
      ) : result.addresses.length === 0 ? (
        <ListEmptyState
          icon={<MapPin />}
          variant="prominent"
          title={
            query.search || query.ownerUserId
              ? "没有匹配的地址"
              : "暂无默认地址"
          }
        />
      ) : (
        <AddressTable>
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
                  if (shouldOpenTableRow(event)) void navigate(destination);
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
                <TableCell className="truncate" title={address.recipientName}>
                  {address.recipientName}
                </TableCell>
                <TableCell className="tabular-nums">
                  <AddressPhoneValue phone={address.phone} />
                </TableCell>
              </TableRow>
            );
          })}
        </AddressTable>
      )}
      {current?.status !== "failed" && result?.addresses.length !== 0 && (
        <ListPagination
          label="地址目录分页"
          result={result}
          className="mt-5"
          onPageChange={(page) =>
            updateQuery((previous) => ({
              ...previous,
              page: page > 1 ? page : undefined,
            }))
          }
          onPageSizeChange={(pageSize) =>
            updateQuery((previous) => ({
              ...previous,
              page: undefined,
              pageSize: readListPageSize(pageSize),
            }))
          }
        />
      )}
    </ListPage>
  );
}

function AddressTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-160 table-fixed border-b">
      <TableCaption className="sr-only">默认地址列表</TableCaption>
      <colgroup>
        {columns.map(({ label, width }) => (
          <col className={width} key={label} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map(({ label }) => (
            <TableHead className="text-muted-foreground" key={label}>
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
