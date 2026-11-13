import { Link } from "@tanstack/react-router";
import { ContactRound, Filter, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { listCustomers } from "@/request/customers";
import type { CustomerListQuery } from "@/request/customers";

import { CustomerPagination } from "../pagination";
import { CustomerListFilters } from "./list-filters";

type CustomerPage = Awaited<ReturnType<typeof listCustomers>>;
type QueryUpdater = (previous: CustomerListQuery) => CustomerListQuery;
type ListState = {
  query: CustomerListQuery;
  customerPage?: CustomerPage;
  error?: string;
};

const columnNames = ["客户编号", "客户名称", "渠道", "标签", "业务员"];

export function CustomerList({
  canCreate,
  query,
  onQueryChange,
  onOpenCustomer,
}: {
  canCreate: boolean;
  query: CustomerListQuery;
  onQueryChange: (update: QueryUpdater, replace?: boolean) => void;
  onOpenCustomer: (id: string) => void;
}) {
  const [loadState, setLoadState] = useState<ListState>();
  const [retry, setRetry] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const currentLoad = loadState?.query === query ? loadState : undefined;
  const customerPage = currentLoad?.customerPage;
  const pageCount = customerPage
    ? Math.max(1, Math.ceil(customerPage.total / customerPage.pageSize))
    : 1;
  const hasFilters = Boolean(
    query.channelCode || query.tagId || query.ownerUserId
  );
  const filterCount =
    Number(Boolean(query.channelCode)) +
    Number(Boolean(query.tagId)) +
    Number(Boolean(query.ownerUserId));
  const selectedTag = customerPage?.customers
    .flatMap((customer) => customer.tags)
    .find((tag) => tag.id === query.tagId);

  useEffect(() => {
    const controller = new AbortController();
    listCustomers(query, controller.signal)
      .then((customerPage) => {
        if (!controller.signal.aborted) setLoadState({ query, customerPage });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          query,
          error:
            error instanceof Error ? error.message : "暂时无法加载客户列表。",
        });
      });
    return () => controller.abort();
  }, [query, retry]);

  useEffect(() => {
    if (!customerPage || customerPage.page <= pageCount) return;
    onQueryChange(
      (previous) => ({
        ...previous,
        page: pageCount > 1 ? pageCount : undefined,
      }),
      true
    );
  }, [customerPage, pageCount, onQueryChange]);

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">
          客户
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <CustomerSearch
            search={query.search ?? ""}
            onSearch={(search) =>
              onQueryChange(
                (previous) => ({ ...previous, search, page: undefined }),
                true
              )
            }
          />
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                className="h-10 gap-2 px-4"
                variant={hasFilters ? "secondary" : "outline"}
                aria-label={
                  hasFilters ? `筛选，已应用 ${filterCount} 项` : "筛选"
                }
              >
                <Filter data-icon="inline-start" />
                筛选
                {hasFilters && (
                  <Badge variant="outline" className="size-5 p-0 tabular-nums">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              aria-label="客户筛选"
              className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
            >
              {filterOpen && (
                <CustomerListFilters
                  filters={{
                    channelCode: query.channelCode,
                    tagId: query.tagId,
                    ownerUserId: query.ownerUserId,
                  }}
                  selectedTag={selectedTag}
                  onApply={(filters) => {
                    setFilterOpen(false);
                    if (
                      filters.channelCode === query.channelCode &&
                      filters.tagId === query.tagId &&
                      filters.ownerUserId === query.ownerUserId
                    )
                      return;
                    onQueryChange((previous) => ({
                      ...previous,
                      channelCode: filters.channelCode,
                      tagId: filters.tagId,
                      ownerUserId: filters.ownerUserId,
                      page: undefined,
                    }));
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          {canCreate && (
            <Button asChild className="h-10 px-4">
              <Link
                to="/customers/new"
                state={{ customerListQuery: query }}
                aria-label="新建客户"
              >
                <Plus data-icon="inline-start" />
                新建
              </Link>
            </Button>
          )}
        </div>
      </div>
      {currentLoad?.error ? (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyTitle>客户列表加载失败</EmptyTitle>
            <EmptyDescription>{currentLoad.error}</EmptyDescription>
          </EmptyHeader>
          <Button
            variant="outline"
            onClick={() => {
              setLoadState(undefined);
              setRetry((value) => value + 1);
            }}
          >
            重试
          </Button>
        </Empty>
      ) : !customerPage || customerPage.page > pageCount ? (
        <div role="status">
          <span className="sr-only">正在加载客户…</span>
          <CustomerTable>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <TableRow aria-hidden="true" key={rowIndex}>
                {columnNames.map((column, columnIndex) => (
                  <TableCell className="h-14" key={column}>
                    <Skeleton
                      className={columnIndex === 1 ? "h-4 w-28" : "h-4 w-16"}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </CustomerTable>
        </div>
      ) : customerPage.customers.length === 0 ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              className="size-12 rounded-xl border bg-background shadow-xs [&_svg]:size-5"
            >
              <ContactRound />
            </EmptyMedia>
            <EmptyTitle className="text-xl font-semibold">
              没有找到符合条件的客户
            </EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? "新建，或者修改你的筛选条件。"
                : "试试修改你的筛选条件。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <CustomerTable>
            {customerPage.customers.map((customer) => (
              <TableRow
                className="cursor-pointer"
                key={customer.id}
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
                  )
                    return;
                  onOpenCustomer(customer.id);
                }}
              >
                <TableCell className="h-14 px-2.5 tabular-nums">
                  {customer.customerNo}
                </TableCell>
                <TableCell className="max-w-0 px-2.5">
                  <Link
                    className="block w-fit max-w-full truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    params={{ customerId: customer.id }}
                    state={{ customerListQuery: query }}
                    title={customer.companyName}
                    to="/customers/$customerId"
                  >
                    {customer.companyName}
                  </Link>
                </TableCell>
                <TableCell className="max-w-0 px-2.5">
                  <ListBadges values={customer.channels} />
                </TableCell>
                <TableCell className="max-w-0 px-2.5">
                  <ListBadges values={customer.tags} />
                </TableCell>
                <TableCell
                  className="truncate px-2.5"
                  title={customer.ownerName}
                >
                  {customer.ownerName}
                </TableCell>
              </TableRow>
            ))}
          </CustomerTable>
          <CustomerPagination
            label="客户列表分页"
            page={customerPage.page}
            pageCount={pageCount}
            total={customerPage.total}
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

function CustomerSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(search);
  const lastSubmitted = useRef<string | undefined>(undefined);

  useEffect(() => {
    const submitted = lastSubmitted.current;
    lastSubmitted.current = undefined;
    if (submitted !== search) setDraft(search);
  }, [search]);

  useEffect(() => {
    const value = draft.trim();
    if (value === search) return;
    const timer = window.setTimeout(() => {
      lastSubmitted.current = value;
      onSearch(value || undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, onSearch, search]);

  return (
    <div className="relative w-56 max-w-full sm:w-80">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        className="h-10 pl-8"
        type="search"
        aria-label="搜索客户编号或名称"
        placeholder="搜索客户编号或名称"
        maxLength={256}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}

function CustomerTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-160 table-fixed border-b">
      <TableCaption className="sr-only">客户列表</TableCaption>
      <colgroup>
        {columnNames.map((column) => (
          <col className="w-1/5" key={column} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columnNames.map((column) => (
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

function ListBadges({ values }: { values: Array<{ name: string }> }) {
  const first = values[0];
  if (!first) return <span className="text-muted-foreground">—</span>;

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      title={values.map(({ name }) => name).join("、")}
    >
      <Badge className="min-w-0 shrink">
        <span className="truncate">{first.name}</span>
      </Badge>
      {values.length > 1 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          等{values.length - 1}个
        </span>
      )}
    </div>
  );
}
