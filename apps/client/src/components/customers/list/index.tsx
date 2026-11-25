import { Link } from "@tanstack/react-router";
import { ContactRound, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ListBadgeSummary } from "@/components/shared/list-badge-summary";
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
import { shouldOpenTableRow } from "@/lib/should-open-table-row";
import { listCustomers } from "@/request/customers";
import type { CustomerListQuery } from "@/request/customers";

import { useCustomerListFilters } from "./filters";

type CustomerPage = Awaited<ReturnType<typeof listCustomers>>;
type QueryUpdater = (previous: CustomerListQuery) => CustomerListQuery;
type ListState = {
  query: CustomerListQuery;
  customerPage?: CustomerPage;
  error?: string;
};

const columns = [
  { label: "客户编号", width: "w-[13%]" },
  { label: "客户名称", width: "w-[32%]" },
  { label: "渠道", width: "w-[21%]" },
  { label: "标签", width: "w-[18%]" },
  { label: "业务员", width: "w-[16%]" },
];

/**
 * 根据路由查询条件加载客户列表，并提供搜索、筛选和分页操作。
 * @param props 列表条件、新建权限，以及更新路由条件和进入客户详情的回调。
 * @returns 客户列表界面，包含加载、空列表和请求失败状态。
 */
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
  const currentLoad = loadState?.query === query ? loadState : undefined;
  const customerPage = currentLoad?.customerPage;
  const pageCount = customerPage
    ? Math.max(1, Math.ceil(customerPage.total / customerPage.pageSize))
    : 1;
  const lastPage = loadState?.customerPage;
  const pageTags = useMemo(
    () =>
      new Map(
        lastPage?.customers.flatMap(({ tags }) =>
          tags.map((tag) => [tag.id, tag] as const)
        )
      ),
    [lastPage]
  );
  const filterModel = useCustomerListFilters(query, onQueryChange, pageTags);

  // 查询条件变化时取消上一次请求，避免旧响应覆盖新列表。
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

  // 当前页超出总页数时回到最后一页，并替换当前历史记录。
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
    <ListPage>
      <ListFilterToolbar
        title="客户"
        filterModel={filterModel}
        search={
          <CustomerSearch
            search={query.search ?? ""}
            onSearch={(search) =>
              onQueryChange(
                (previous) => ({ ...previous, search, page: undefined }),
                true
              )
            }
          />
        }
        actions={
          canCreate && (
            <Button asChild size="icon">
              <Link
                to="/customers/new"
                state={{ customerListQuery: query }}
                aria-label="新建客户"
                title="新建客户"
              >
                <Plus aria-hidden="true" />
              </Link>
            </Button>
          )
        }
      />
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
                {columns.map(({ label }, columnIndex) => (
                  <TableCell className="h-11" key={label}>
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
        <ListEmptyState
          icon={<ContactRound />}
          variant="prominent"
          title="没有找到符合条件的客户"
          description={
            canCreate
              ? "新建，或者修改你的筛选条件。"
              : "试试修改你的筛选条件。"
          }
        />
      ) : (
        <>
          <CustomerTable>
            {customerPage.customers.map((customer) => (
              <TableRow
                className="cursor-pointer"
                key={customer.id}
                onClick={(event) => {
                  if (shouldOpenTableRow(event)) onOpenCustomer(customer.id);
                }}
              >
                <TableCell className="py-3 tabular-nums">
                  {customer.customerNo}
                </TableCell>
                <TableCell className="max-w-0">
                  <Link
                    className={`${tableLinkClassName} font-medium`}
                    params={{ customerId: customer.id }}
                    state={{ customerListQuery: query }}
                    title={customer.companyName}
                    to="/customers/$customerId"
                  >
                    {customer.companyName}
                  </Link>
                </TableCell>
                <TableCell className="max-w-0">
                  <ListBadgeSummary
                    items={customer.channels}
                    showColors={false}
                  />
                </TableCell>
                <TableCell className="max-w-0">
                  <ListBadgeSummary items={customer.tags} />
                </TableCell>
                <TableCell className="truncate" title={customer.ownerName}>
                  {customer.ownerName}
                </TableCell>
              </TableRow>
            ))}
          </CustomerTable>
          <ListPagination
            label="客户列表分页"
            page={customerPage.page}
            pageCount={pageCount}
            total={customerPage.total}
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
    </ListPage>
  );
}

/**
 * 显示客户搜索框，并将输入防抖后同步给调用方。
 * @param props 当前路由中的搜索词，以及接收新搜索词的回调。清空时回调接收 `undefined`。
 * @returns 按客户编号或名称搜索的输入框。
 */
function CustomerSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(search);
  const lastSubmitted = useRef<string | undefined>(undefined);

  // 路由因前进或后退等外部导航变化时，用路由参数恢复输入。
  useEffect(() => {
    const submitted = lastSubmitted.current;
    lastSubmitted.current = undefined;
    if (submitted !== search) setDraft(search);
  }, [search]);

  // 停止输入 300 毫秒后再更新查询条件。
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
    <ListSearchInput
      aria-label="搜索客户编号或名称"
      placeholder="客户名称或编号"
      maxLength={256}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

function CustomerTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-160 table-fixed border-b">
      <TableCaption className="sr-only">客户列表</TableCaption>
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
