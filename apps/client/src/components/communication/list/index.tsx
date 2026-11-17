import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Filter, MessagesSquare, Plus, Search } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { readListQueryFromState } from "@/components/customers/list-query";
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
import {
  communicationStatusLabels,
  listCommunications,
} from "@/request/communication";
import type {
  CommunicationListQuery,
  CommunicationListTag,
} from "@/request/communication";

import { CommunicationCustomerLink } from "../customer-link";
import { CommunicationListFilters } from "./filters";

type QueryUpdater = (
  previous: CommunicationListQuery
) => CommunicationListQuery;
type CommunicationPage = Awaited<ReturnType<typeof listCommunications>>;
type ListState = {
  query: CommunicationListQuery;
  customerId?: string;
  result?: CommunicationPage;
  error?: string;
};

const defaultColumns = ["主题", "客户", "标签", "状态", "业务员", "最近更新"];
const customerColumns = defaultColumns.filter((name) => name !== "客户");

/** 在客户详情中查询当前客户的沟通，复用独立列表的筛选、分页和新建入口。 */
export function CustomerCommunicationTab({
  customerId,
}: {
  customerId: string;
}) {
  const [query, setQuery] = useState<CommunicationListQuery>({});
  return (
    <CommunicationList
      canCreate
      customerId={customerId}
      query={query}
      onQueryChange={setQuery}
    />
  );
}

/** 按当前入口加载沟通列表，并在导航时保留来源。 */
export function CommunicationList({
  canCreate,
  customerId,
  query,
  onQueryChange,
}: {
  canCreate: boolean;
  customerId?: string;
  query: CommunicationListQuery;
  onQueryChange: (update: QueryUpdater, replace?: boolean) => void;
}) {
  const navigate = useNavigate();
  const previousState = useRouterState({
    select: (state) => state.location.state,
  });
  const navigationState = customerId
    ? { customerListQuery: readListQueryFromState(previousState) }
    : { communicationListQuery: query };
  const origin = customerId ? { customerId } : {};
  const columns = customerId ? customerColumns : defaultColumns;
  const [load, setLoad] = useState<ListState>();
  const [retry, setRetry] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const current =
    load?.query === query && load.customerId === customerId ? load : undefined;
  const result = current?.result;
  const pageCount = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;
  const filterCount =
    Number(Boolean(query.status)) +
    Number(Boolean(query.tagId)) +
    Number(Boolean(query.ownerUserId));
  const selectedTag = result?.communications
    .flatMap(({ tags }) => tags)
    .find(({ id }) => id === query.tagId);

  useEffect(() => {
    const controller = new AbortController();
    void listCommunications({ ...query, customerId }, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoad({ query, customerId, result });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setLoad({
            query,
            customerId,
            error:
              failure instanceof Error
                ? failure.message
                : "暂时无法加载沟通记录。",
          });
      }
    );
    return () => controller.abort();
  }, [customerId, query, retry]);

  useEffect(() => {
    if (result && result.page > pageCount)
      onQueryChange(
        (current) => ({
          ...current,
          page: pageCount > 1 ? pageCount : undefined,
        }),
        true
      );
  }, [result, pageCount, onQueryChange]);

  const submitSearch = useCallback(
    (search: string | undefined) =>
      onQueryChange(
        (previous) => ({ ...previous, search, page: undefined }),
        true
      ),
    [onQueryChange]
  );

  return (
    <section aria-label={customerId ? "客户沟通记录" : "沟通记录"}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {!customerId && (
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight">
            沟通
          </h1>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <CommunicationSearch
            search={query.search ?? ""}
            onSearch={submitSearch}
          />
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
              align="end"
              sideOffset={8}
              aria-label="沟通筛选"
              className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
            >
              {filterOpen && (
                <CommunicationListFilters
                  filters={{
                    status: query.status,
                    tagId: query.tagId,
                    ownerUserId: query.ownerUserId,
                  }}
                  selectedTag={selectedTag}
                  onApply={({ status, tagId, ownerUserId }) => {
                    setFilterOpen(false);
                    if (
                      status === query.status &&
                      tagId === query.tagId &&
                      ownerUserId === query.ownerUserId
                    )
                      return;
                    onQueryChange((previous) => ({
                      ...previous,
                      status,
                      tagId,
                      ownerUserId,
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
                aria-label="新建沟通"
                to="/communication/new"
                search={origin}
                state={navigationState}
              >
                <Plus data-icon="inline-start" />
                新建
              </Link>
            </Button>
          )}
        </div>
      </div>
      {current?.error ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyTitle>沟通记录加载失败</EmptyTitle>
            <EmptyDescription role="alert">{current.error}</EmptyDescription>
          </EmptyHeader>
          <Button
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
          <span className="sr-only">正在加载沟通记录…</span>
          <CommunicationTable columns={columns}>
            {Array.from({ length: 4 }, (_, index) => (
              <TableRow aria-hidden="true" key={index}>
                {columns.map((column) => (
                  <TableCell className="h-14 px-2.5" key={column}>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </CommunicationTable>
        </div>
      ) : result.communications.length === 0 ? (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              className="size-12 rounded-xl border bg-background shadow-xs [&_svg]:size-5"
            >
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle className="text-xl font-semibold">
              没有找到符合条件的沟通记录
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
          <CommunicationTable columns={columns}>
            {result.communications.map((communication) => {
              const updatedAt = new Date(communication.updatedAt);
              const destination = {
                to: "/communication/$communicationId" as const,
                params: { communicationId: communication.id },
                search: origin,
                state: navigationState,
              };
              return (
                <TableRow
                  key={communication.id}
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
                  <TableCell className="h-14 px-2.5">
                    <Link
                      {...destination}
                      preload={false}
                      className="block w-fit max-w-full truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      title={communication.title}
                    >
                      {communication.title}
                    </Link>
                  </TableCell>
                  {!customerId && (
                    <TableCell className="max-w-0 truncate px-2.5">
                      <CommunicationCustomerLink
                        customer={
                          communication.canViewCustomer
                            ? communication.customer
                            : null
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="max-w-0 px-2.5">
                    <TagBadges tags={communication.tags} />
                  </TableCell>
                  <TableCell className="px-2.5">
                    <Badge
                      variant={
                        communication.status === "urgent"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {communicationStatusLabels[communication.status]}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="truncate px-2.5"
                    title={communication.ownerName}
                  >
                    {communication.ownerName}
                  </TableCell>
                  <TableCell className="px-2.5 tabular-nums">
                    <time
                      dateTime={communication.updatedAt}
                      title={updatedAt.toLocaleString("zh-CN")}
                    >
                      {updatedAt.toLocaleDateString("sv-SE")}
                    </time>
                  </TableCell>
                </TableRow>
              );
            })}
          </CommunicationTable>
          <CustomerPagination
            label="沟通记录分页"
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
    </section>
  );
}

function CommunicationSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (search: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(search);
  const lastSubmitted = useRef<string | undefined>(undefined);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    const submitted = lastSubmitted.current;
    lastSubmitted.current = undefined;
    if (submitted !== search) setDraft(search);
  }, [search]);

  useEffect(() => {
    const value = draft.trim();
    if (composing || value === search) return;
    const timer = window.setTimeout(() => {
      lastSubmitted.current = value;
      onSearch(value || undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, onSearch, search, composing]);

  return (
    <div className="relative w-56 max-w-full sm:w-72">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        className="h-10 pl-8"
        type="search"
        aria-label="搜索沟通"
        placeholder="搜索"
        maxLength={256}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
    </div>
  );
}

function CommunicationTable({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <Table className="min-w-160 table-fixed border-b">
      <TableCaption className="sr-only">沟通记录列表</TableCaption>
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

function TagBadges({ tags }: { tags: CommunicationListTag[] }) {
  const first = tags[0];
  if (!first) return <span className="text-muted-foreground">—</span>;
  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      title={tags.map(({ name }) => name).join("、")}
    >
      <Badge className="min-w-0 shrink">
        <span className="truncate">{first.name}</span>
      </Badge>
      {tags.length > 1 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          等{tags.length - 1}个
        </span>
      )}
    </div>
  );
}
