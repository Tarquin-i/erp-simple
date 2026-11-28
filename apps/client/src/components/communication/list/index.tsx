import {
  getRouteApi,
  Link,
  useNavigate,
  useRouteContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { cn } from "cn";
import { Clock, LoaderCircle, MessagesSquare, Plus } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { readListQueryFromState } from "@/components/customers/list-query";
import { ListBadgeSummary } from "@/components/shared/list-badge-summary";
import { ListEmptyState } from "@/components/core/data-table/list-empty-state";
import { ListPagination } from "@/components/core/data-table/list-pagination";
import { ListSearchInput } from "@/components/core/data-table/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
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
import {
  communicationStatusLabels,
  listCommunications,
} from "@/request/communication";
import type { CommunicationListQuery } from "@/request/communication";

import { CommunicationCustomerLink } from "../customer-link";
import {
  hasPendingCreation,
  readCreationRecovery,
  subscribeToCreationSubmissions,
} from "../form/creation-submission";
import { CommunicationFilterToolbar } from "./filters";

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

const defaultColumns = [
  { label: "主题", width: "w-[30%]" },
  { label: "客户", width: "w-[19%]" },
  { label: "标签", width: "w-[12%]" },
  { label: "状态", width: "w-[11%]" },
  { label: "业务员", width: "w-[14%]" },
  { label: "最近更新", width: "w-[14%]" },
];
const customerColumns = [
  { label: "主题", width: "w-[30%]" },
  { label: "标签", width: "w-[18%]" },
  { label: "状态", width: "w-[16%]" },
  { label: "业务员", width: "w-[18%]" },
  { label: "最近更新", width: "w-[18%]" },
];
const pendingRows = Array.from({ length: 5 }, (_, rowId) => rowId);
const customerPendingRows = pendingRows.slice(0, 4);
const pendingCreationLabel = "处理待确认提交";
const noPendingCreation = () => false;
const customerDetailRoute = getRouteApi("/_protected/customers/$customerId/");

/** 在客户详情中展示当前客户的沟通和分页，并把新建入口放到页签栏。 */
export function CustomerCommunicationTab({
  customerId,
  createActionSlot,
}: {
  customerId: string;
  createActionSlot: HTMLDivElement | null;
}) {
  const { communicationPage, communicationPageSize } =
    customerDetailRoute.useSearch();
  const navigate = customerDetailRoute.useNavigate();
  const query = useMemo(
    () => ({ page: communicationPage, pageSize: communicationPageSize }),
    [communicationPage, communicationPageSize]
  );
  const updateQuery = useCallback(
    (update: QueryUpdater, replace?: boolean) =>
      void navigate({
        search: (previous) => {
          const next = update({
            page: previous.communicationPage,
            pageSize: previous.communicationPageSize,
          });
          return {
            ...previous,
            communicationPage: next.page,
            communicationPageSize: next.pageSize,
          };
        },
        state: (previous) => previous,
        replace,
        resetScroll: false,
      }),
    [navigate]
  );
  return (
    <CommunicationList
      canCreate
      customerId={customerId}
      createActionSlot={createActionSlot}
      query={query}
      onQueryChange={updateQuery}
    />
  );
}

/** 按当前入口加载沟通列表，并在导航时保留来源。 */
export function CommunicationList({
  canCreate,
  customerId,
  createActionSlot,
  query,
  onQueryChange,
}: {
  canCreate: boolean;
  customerId?: string;
  createActionSlot?: HTMLDivElement | null;
  query: CommunicationListQuery;
  onQueryChange: (update: QueryUpdater, replace?: boolean) => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const {
    viewer: { account },
  } = useRouteContext({ from: "/_protected" });
  const readPendingCreation = useCallback(
    () => hasPendingCreation(account.id),
    [account.id]
  );
  const hasPending = useSyncExternalStore(
    subscribeToCreationSubmissions,
    readPendingCreation,
    noPendingCreation
  );
  const previousState = useRouterState({
    select: (state) => state.location.state,
  });
  const navigationState = customerId
    ? { customerListQuery: readListQueryFromState(previousState) }
    : { communicationListQuery: query };
  const origin = customerId
    ? {
        customerId,
        communicationPage: query.page,
        communicationPageSize: query.pageSize,
      }
    : {};
  const customerView = Boolean(customerId);
  const columns = customerView ? customerColumns : defaultColumns;
  const [load, setLoad] = useState<ListState>();
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const [creationError, setCreationError] = useState("");
  const openingRef = useRef(false);
  const current =
    load?.query === query && load.customerId === customerId ? load : undefined;
  const loadedPage = current?.result;
  const pageCount = loadedPage
    ? Math.max(1, Math.ceil(loadedPage.total / loadedPage.pageSize))
    : 1;
  const result =
    loadedPage && loadedPage.page <= pageCount ? loadedPage : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies(retry): 重试时按同一查询条件重新加载沟通列表。
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
    if (loadedPage && loadedPage.page > pageCount)
      onQueryChange(
        (current) => ({
          ...current,
          page: pageCount > 1 ? pageCount : undefined,
        }),
        true
      );
  }, [loadedPage, pageCount, onQueryChange]);

  const submitSearch = useCallback(
    (search: string | undefined) =>
      onQueryChange(
        (previous) => ({ ...previous, search, page: undefined }),
        true
      ),
    [onQueryChange]
  );

  async function openPendingCreation() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setCreationError("");

    let leftList = false;
    const unsubscribe = router.history.subscribe(() => {
      leftList = true;
    });

    try {
      const recovery = readCreationRecovery(account.id);
      // 在当前列表等待点击时的请求，期间不另发保存，也不进入空白表单。
      const outcome = await recovery?.attempt;
      if (leftList) return;

      if (outcome?.status === "saved") {
        const { communication } = outcome;
        await navigate({
          to: "/communication/$communicationId",
          params: { communicationId: communication.id },
          search:
            communication.canViewCustomer &&
            communication.customerId === customerId
              ? origin
              : {},
          state: navigationState,
        });
      } else if (recovery && (!outcome || outcome.status === "pending")) {
        await navigate({
          to: "/communication/new",
          search: { ...origin, submissionId: recovery.submission.id },
          state: {
            ...navigationState,
            communicationRecoveryMessage: outcome?.message,
          },
        });
      } else if (outcome?.status === "rejected") {
        setCreationError(`本次提交未保存。${outcome.error.message}`);
      } else {
        setCreationError("这笔提交的待确认状态已结束，请在列表核对保存结果。");
        setRetry((attempt) => attempt + 1);
      }
    } catch (failure) {
      if (!leftList) {
        setCreationError(
          failure instanceof Error
            ? failure.message
            : "暂时无法打开待确认提交。"
        );
      }
    } finally {
      unsubscribe();
      openingRef.current = false;
      setOpening(false);
    }
  }

  const createAction =
    canCreate &&
    (opening || hasPending ? (
      <Button
        type="button"
        className="px-3"
        aria-busy={opening}
        disabled={opening}
        onClick={() => void openPendingCreation()}
      >
        {opening ? (
          <LoaderCircle
            className="motion-safe:animate-spin"
            data-icon="inline-start"
          />
        ) : (
          <Clock data-icon="inline-start" />
        )}
        {opening ? "正在等待保存结果…" : pendingCreationLabel}
      </Button>
    ) : (
      <Button asChild size="icon">
        <Link
          aria-label="新建沟通"
          title="新建沟通"
          to="/communication/new"
          search={origin}
          state={navigationState}
        >
          <Plus aria-hidden="true" />
        </Link>
      </Button>
    ));

  return (
    <section aria-label={customerId ? "客户沟通记录" : "沟通记录"}>
      {customerId ? (
        createActionSlot && createPortal(createAction, createActionSlot)
      ) : (
        <CommunicationFilterToolbar
          query={query}
          records={load?.result?.communications}
          onQueryChange={onQueryChange}
          search={
            <CommunicationSearch
              search={query.search ?? ""}
              onSearch={submitSearch}
            />
          }
          actions={createAction}
        />
      )}
      {creationError && (
        <FieldError className="mb-4">{creationError}</FieldError>
      )}
      {current?.error ? (
        <Empty className={cn("border", customerView ? "min-h-52" : "min-h-56")}>
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
      ) : !result ? (
        <div role="status">
          <span className="sr-only">正在加载沟通记录…</span>
          <CommunicationTable columns={columns} customerView={customerView}>
            {(customerView ? customerPendingRows : pendingRows).map((rowId) => (
              <TableRow aria-hidden="true" key={rowId}>
                {columns.map(({ label }) => (
                  <TableCell
                    className={customerView ? "h-11.25" : "h-11"}
                    key={label}
                  >
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </CommunicationTable>
        </div>
      ) : result.communications.length === 0 ? (
        <ListEmptyState
          icon={<MessagesSquare />}
          variant={customerView ? "default" : "prominent"}
          title={customerId ? "暂无沟通记录" : "没有找到符合条件的沟通记录"}
          description={
            customerId
              ? undefined
              : canCreate && !hasPending
                ? "新建，或者修改你的筛选条件。"
                : "试试修改你的筛选条件。"
          }
        />
      ) : (
        <CommunicationTable columns={columns} customerView={customerView}>
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
                  if (shouldOpenTableRow(event)) void navigate(destination);
                }}
              >
                <TableCell className={customerView ? "h-11.25" : "py-3"}>
                  <Link
                    {...destination}
                    preload={false}
                    className={tableLinkClassName}
                    title={communication.title}
                  >
                    {communication.title}
                  </Link>
                </TableCell>
                {!customerId && (
                  <TableCell className="max-w-0 truncate">
                    <CommunicationCustomerLink
                      className={tableLinkClassName}
                      customer={
                        communication.canViewCustomer
                          ? communication.customer
                          : null
                      }
                    />
                  </TableCell>
                )}
                <TableCell className="max-w-0">
                  <ListBadgeSummary items={communication.tags} />
                </TableCell>
                <TableCell className="py-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge
                      variant={
                        communication.status === "urgent"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {communicationStatusLabels[communication.status]}
                    </Badge>
                    {communication.archiveStartedAt && (
                      <Badge variant="outline">归档中</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="truncate" title={communication.ownerName}>
                  {communication.ownerName}
                </TableCell>
                <TableCell className="tabular-nums">
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
      )}
      {!current?.error && result?.communications.length !== 0 && (
        <ListPagination
          label="沟通记录分页"
          result={result}
          className="mt-5"
          onPageChange={(page) =>
            onQueryChange((previous) => ({
              ...previous,
              page: page > 1 ? page : undefined,
            }))
          }
          onPageSizeChange={(size) =>
            onQueryChange((previous) => ({
              ...previous,
              page: undefined,
              pageSize: readListPageSize(size),
            }))
          }
        />
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
    <ListSearchInput
      aria-label="搜索沟通"
      placeholder="搜索沟通"
      maxLength={256}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
    />
  );
}

function CommunicationTable({
  columns,
  customerView,
  children,
}: {
  columns: { label: string; width: string }[];
  customerView: boolean;
  children: ReactNode;
}) {
  return (
    <Table
      className={cn(
        "table-fixed border-b",
        customerView ? "min-w-160" : "min-w-180"
      )}
    >
      <TableCaption className="sr-only">沟通记录列表</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map(({ label, width }) => (
            <TableHead
              className={cn("text-muted-foreground", width)}
              key={label}
            >
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
