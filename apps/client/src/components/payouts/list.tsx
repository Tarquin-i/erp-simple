import { Link } from "@tanstack/react-router";
import { CircleDollarSign, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ListEmptyState } from "@/components/shared/list-empty-state";
import { ListFilterToolbar } from "@/components/shared/list-filter-toolbar";
import { ListPage } from "@/components/shared/list-page";
import { ListPagination } from "@/components/shared/list-pagination";
import { ListSearchInput } from "@/components/shared/list-toolbar";
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
import {
  formatPayoutMoney,
  formatPayoutPercent,
  formatPayoutQuantity,
} from "@/lib/payouts";
import { listPayouts } from "@/request/payouts";

import { usePayoutListFilters } from "./list-filters";
import { payoutListOrigin } from "./navigation";
import type { PayoutListSearch } from "./navigation";

type PayoutPage = Awaited<ReturnType<typeof listPayouts>>;
type ListState = {
  key: string;
  result?: PayoutPage;
  error?: string;
};

const columns = [
  { label: "Payout 名称", width: "w-[20%]" },
  { label: "产品", width: "w-[20%]" },
  { label: "总张数", width: "w-[10%]" },
  { label: "中奖张数", width: "w-[10%]" },
  { label: "预计赔付", width: "w-[16%]" },
  { label: "赔付率", width: "w-[9%]" },
  { label: "创建时间", width: "w-[15%]" },
];
const pendingRows = Array.from({ length: 5 }, (_, rowId) => rowId);
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
});

export function PayoutList({
  query,
  entryIndex,
  onChangeQuery,
}: {
  query: PayoutListSearch;
  entryIndex: number;
  onChangeQuery: (
    update: (query: PayoutListSearch) => PayoutListSearch,
    replace?: boolean
  ) => void;
}) {
  const [load, setLoad] = useState<ListState>();
  const [retry, setRetry] = useState(0);
  const { search = "", productId, productOperator, page = 1, pageSize } = query;
  const [searchDraft, setSearchDraft] = useState(search);
  const lastSubmittedSearch = useRef<string | undefined>(undefined);
  const trimmedSearch = searchDraft.trim();
  const key = JSON.stringify([
    search,
    productId,
    productOperator,
    page,
    pageSize,
    retry,
  ]);
  const activeLoad =
    load?.key === key && trimmedSearch === search ? load : undefined;
  const loadedPage = activeLoad?.result;
  const pageCount = loadedPage
    ? Math.max(1, Math.ceil(loadedPage.total / loadedPage.pageSize))
    : 1;
  const result =
    loadedPage && loadedPage.page <= pageCount ? loadedPage : undefined;
  const listOrigin = payoutListOrigin(query);
  const filterModel = usePayoutListFilters(
    query,
    onChangeQuery,
    result?.payouts
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
      onChangeQuery(
        (previous) => ({
          ...previous,
          search: trimmedSearch || undefined,
          page: undefined,
        }),
        true
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [trimmedSearch, search, onChangeQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listPayouts(
      {
        search: search || undefined,
        productId,
        productOperator,
        page,
        pageSize,
      },
      signal
    ).then(
      (result) => {
        if (!signal.aborted) setLoad({ key, result });
      },
      (failure: unknown) => {
        if (!signal.aborted) {
          setLoad({
            key,
            error:
              failure instanceof Error
                ? failure.message
                : "Payout 列表加载失败。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [key, page, pageSize, productId, productOperator, search]);

  useEffect(() => {
    if (loadedPage && loadedPage.page > pageCount)
      onChangeQuery(
        (previous) => ({
          ...previous,
          page: pageCount > 1 ? pageCount : undefined,
        }),
        true
      );
  }, [loadedPage, pageCount, onChangeQuery]);

  return (
    <ListPage>
      <ListFilterToolbar
        title="Payout"
        filterModel={filterModel}
        search={
          <ListSearchInput
            aria-label="搜索 Payout"
            placeholder="奖表或产品名称"
            maxLength={256}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        }
        actions={
          <Button asChild size="icon">
            <Link
              to="/payouts/new"
              search={listOrigin}
              state={{ payoutListEntryIndex: entryIndex }}
              aria-label="新建 Payout"
              title="新建 Payout"
            >
              <Plus aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {activeLoad?.error ? (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyTitle>Payout 列表加载失败</EmptyTitle>
            <EmptyDescription>{activeLoad.error}</EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRetry((attempt) => attempt + 1)}
          >
            重试
          </Button>
        </Empty>
      ) : !result ? (
        <div role="status">
          <span className="sr-only">正在加载 Payout…</span>
          <PayoutTable>
            {pendingRows.map((rowId) => (
              <TableRow key={rowId} aria-hidden="true">
                {columns.map(({ label }) => (
                  <TableCell className="h-11" key={label}>
                    <Skeleton className="h-4 w-24 max-w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </PayoutTable>
        </div>
      ) : result.payouts.length === 0 ? (
        <ListEmptyState
          icon={<CircleDollarSign aria-hidden="true" />}
          title={
            search || filterModel.filters.length
              ? "没有找到符合条件的 Payout"
              : "暂无 Payout"
          }
        />
      ) : (
        <PayoutTable>
          {result.payouts.map((payout) => (
            <TableRow key={payout.id} className="relative cursor-pointer">
              <TableCell className="max-w-0 py-3">
                <Link
                  className={`${tableLinkClassName} after:absolute after:inset-0 after:content-['']`}
                  to="/payouts/$payoutId"
                  params={{ payoutId: payout.id }}
                  search={listOrigin}
                  state={{ payoutListEntryIndex: entryIndex }}
                  title={payout.name}
                >
                  {payout.name}
                </Link>
              </TableCell>
              <TableCell className="max-w-0">
                <Link
                  className={`${tableLinkClassName} relative z-10`}
                  to="/products/$productId"
                  params={{ productId: payout.product.id }}
                  title={payout.product.name}
                >
                  {payout.product.name}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">
                {formatPayoutQuantity(payout.ticketCount)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatPayoutQuantity(payout.metrics.winningTicketCount)}
              </TableCell>
              <TableCell
                className="max-w-0 tabular-nums"
                title={`${payout.currencyCode} ${payout.metrics.payoutAmount}`}
              >
                <span className="block truncate">
                  {formatPayoutMoney(
                    payout.metrics.payoutAmount,
                    payout.currencyCode
                  )}
                </span>
              </TableCell>
              <TableCell
                className="max-w-0 tabular-nums"
                title={formatPayoutPercent(payout.metrics.paybackPercent)}
              >
                <span className="block truncate">
                  {formatPayoutPercent(payout.metrics.paybackPercent)}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                <time dateTime={payout.createdAt}>
                  {dateTime.format(new Date(payout.createdAt))}
                </time>
              </TableCell>
            </TableRow>
          ))}
        </PayoutTable>
      )}
      {!activeLoad?.error && result?.payouts.length !== 0 && (
        <ListPagination
          label="Payout 列表分页"
          result={result}
          className="mt-5"
          onPageChange={(next) =>
            onChangeQuery((previous) => ({
              ...previous,
              page: next > 1 ? next : undefined,
            }))
          }
          onPageSizeChange={(pageSize) =>
            onChangeQuery((previous) => ({
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

function PayoutTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-240 table-fixed border-b">
      <TableCaption className="sr-only">Payout 列表</TableCaption>
      <colgroup>
        {columns.map(({ label, width }) => (
          <col key={label} className={width} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map(({ label }) => (
            <TableHead key={label} className="text-muted-foreground">
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
