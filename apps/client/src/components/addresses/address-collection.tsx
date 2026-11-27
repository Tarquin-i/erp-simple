import { MapPin } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ListEmptyState } from "@/components/shared/list-empty-state";
import { ListLoadError } from "@/components/shared/list-load-error";
import { toastManager } from "@/components/shared/toast";
import {
  VirtualList,
  type VirtualListHandle,
  type VirtualScrollAnchor,
} from "@/components/shared/virtual-list";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  AddressApiError,
  type AddressDetail,
  type AddressListItem,
  listCustomerAddresses,
} from "@/request/addresses";

import { AddressCard, type AddressCardDetailResult } from "./address-card";
import type { AddressAction } from "./address-card-menu";
import { AddressCollectionPending, addressCollectionClass } from "./load-state";

type AddressPage = Awaited<ReturnType<typeof listCustomerAddresses>>;
type RefreshDetail = (signal: AbortSignal) => Promise<boolean | undefined>;
type AddressCollectionProps = {
  customerId: string;
  customerTab?: boolean;
  header?: ReactNode;
  currentAddress?: AddressDetail;
  refreshDetailAfterDefault?: RefreshDetail;
  onChanged?: (address: AddressDetail) => Promise<boolean | undefined>;
};

type AddressRead = { page: number } & (
  | { kind: "page" }
  | { kind: "refresh"; pageSize: number; changedId: string }
);
type PendingRead = { read: AddressRead; error?: string };

const firstPage = { kind: "page", page: 1 } as const;
const addressPageSizeLimit = 100;
const estimateCardSize = () => 112;

/** 以接口支持的最大批次重读前缀，继续加载时仍沿用原来的分页大小。 */
async function readLoadedAddresses(
  customerId: string,
  { page, pageSize }: Pick<AddressPage, "page" | "pageSize">,
  signal: AbortSignal
): Promise<AddressPage> {
  const size = page * pageSize;
  const batchSize = Math.min(size, addressPageSizeLimit);
  let result = await listCustomerAddresses(
    customerId,
    { page: 1, pageSize: batchSize },
    signal
  );
  const addresses = new Map(
    result.addresses.map((address) => [address.id, address])
  );
  for (
    let batch = 2;
    (batch - 1) * batchSize < Math.min(size, result.total);
    batch++
  ) {
    result = await listCustomerAddresses(
      customerId,
      { page: batch, pageSize: batchSize },
      signal
    );
    for (const address of result.addresses) addresses.set(address.id, address);
  }
  return {
    ...result,
    page,
    pageSize,
    addresses: [...addresses.values()].slice(0, size),
  };
}

/**
 * 逐批读取一个客户的有效地址，滚动时只渲染附近卡片并保留已展开的状态。
 * @param props 客户 ID、可选标题、当前地址详情及写入后回调。
 * @returns 客户地址列表、加载状态和失败重试入口。
 */
export function AddressCollection({
  customerId,
  customerTab,
  header,
  currentAddress,
  refreshDetailAfterDefault,
  onChanged,
}: AddressCollectionProps) {
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const latestCollection = useRef<AddressPage | undefined>(undefined);
  const list = useRef<VirtualListHandle>(null);
  const [collection, setCollection] = useState<AddressPage>();
  const [request, setRequest] = useState<PendingRead | undefined>({
    read: firstPage,
  });
  const [scrollAnchor, setScrollAnchor] = useState<VirtualScrollAnchor>();
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  );
  const [details, setDetails] = useState<
    ReadonlyMap<string, AddressCardDetailResult>
  >(() => new Map());
  const [retainedIds, setRetainedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const loadAddresses = useCallback(
    async (read: AddressRead, refreshDetail?: RefreshDetail) => {
      active.current?.abort();
      const controller = new AbortController();
      const { signal } = controller;
      active.current = controller;
      setRequest({ read });
      try {
        if (refreshDetail) {
          const ready = await refreshDetail(signal);
          if (signal.aborted) return false;
          if (ready === false) {
            setRequest(undefined);
            return false;
          }
        }
        const result =
          read.kind === "refresh"
            ? await readLoadedAddresses(customerId, read, signal)
            : await listCustomerAddresses(
                customerId,
                { page: read.page },
                signal
              );
        if (signal.aborted) return false;
        const previous = latestCollection.current;
        let next = result;
        if (read.kind === "refresh") {
          const ids = new Set(result.addresses.map(({ id }) => id));
          setScrollAnchor(
            list.current?.getScrollAnchor(
              (id) => id !== read.changedId && ids.has(id)
            )
          );
        } else if (previous && read.page > 1) {
          const items = new Map(
            previous.addresses.map((item) => [item.id, item])
          );
          for (const item of result.addresses) items.set(item.id, item);
          next = { ...result, addresses: [...items.values()] };
        }
        latestCollection.current = next;
        setCollection(next);
        setRequest(undefined);
        return true;
      } catch (failure) {
        if (signal.aborted) return false;
        if (
          failure instanceof AddressApiError &&
          [401, 403, 404].includes(failure.status)
        ) {
          latestCollection.current = undefined;
          setCollection(undefined);
          setScrollAnchor(undefined);
          setDetails(new Map());
          setRequest({ read: firstPage, error: failure.message });
          return false;
        }
        setRequest({
          read,
          error:
            (failure instanceof Error && failure.message) ||
            "暂时无法加载地址。",
        });
        if (read.kind === "refresh") {
          toastManager.add({
            title: "操作已完成，列表刷新失败。请手动刷新页面。",
            type: "error",
          });
        }
        return false;
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
    [customerId]
  );

  useEffect(() => {
    mounted.current = true;
    void loadAddresses(firstPage);
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [loadAddresses]);

  const onOpenChange = useCallback((id: string, open: boolean) => {
    setExpanded((previous) => new Map(previous).set(id, open));
  }, []);

  const onDetailChange = useCallback(
    (id: string, result: AddressCardDetailResult | undefined) => {
      setDetails((previous) => {
        const next = new Map(previous);
        if (result) next.set(id, result);
        else next.delete(id);
        return next;
      });
    },
    []
  );

  const onRetainChange = useCallback((id: string, retained: boolean) => {
    setRetainedIds((previous) => {
      if (previous.has(id) === retained) return previous;
      const next = new Set(previous);
      if (retained) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  async function refreshAfterChange(
    address: AddressDetail,
    action: AddressAction
  ) {
    if (!mounted.current) return false;
    const refreshDetail =
      action === "default" ? refreshDetailAfterDefault : undefined;
    if (!refreshDetail && (await onChanged?.(address)) === false) return false;
    if (!mounted.current) return false;
    const loaded = latestCollection.current;
    // 默认标记和修改时间会改变排序，等已读范围全部刷新后再替换。
    return loadAddresses(
      loaded
        ? {
            kind: "refresh",
            page: loaded.page,
            pageSize: loaded.pageSize,
            changedId: address.id,
          }
        : firstPage,
      refreshDetail
    );
  }

  const hasMore = Boolean(
    collection && collection.page * collection.pageSize < collection.total
  );
  const loadNext = useCallback(() => {
    if (collection && hasMore && !active.current && !request)
      void loadAddresses({ kind: "page", page: collection.page + 1 });
  }, [collection, hasMore, loadAddresses, request]);
  const pageError = request?.read.kind === "page" ? request.error : undefined;

  function retryAddresses() {
    if (!request?.error || active.current) return;
    void loadAddresses(request.read);
  }

  const items = useMemo(() => {
    if (!collection) return [];
    const { addresses, pageSize } = collection;
    if (!currentAddress) return addresses;
    const index = addresses.findIndex(({ id }) => id === currentAddress.id);
    if (index >= 0 && index < pageSize) return addresses;
    // 旧地址直接进入详情时无需预读中间批次，追加时也只展示同一个卡片。
    return [
      addresses[index] ?? currentAddress,
      ...addresses.filter(({ id }) => id !== currentAddress.id),
    ];
  }, [collection, currentAddress]);

  function renderCard(address: AddressListItem) {
    const current =
      currentAddress?.id === address.id ? currentAddress : undefined;
    return (
      <AddressCard
        address={address}
        currentAddress={current}
        open={expanded.get(address.id) ?? Boolean(current)}
        loaded={details.get(address.id)}
        onOpenChange={onOpenChange}
        onDetailChange={onDetailChange}
        onRetainChange={onRetainChange}
        onChanged={refreshAfterChange}
      />
    );
  }

  if (customerTab && !collection && pageError) {
    return (
      <ListLoadError
        title="暂时无法加载地址"
        message={pageError}
        onRetry={retryAddresses}
      />
    );
  }
  if (customerTab && collection && items.length === 0 && !request) {
    return <ListEmptyState icon={<MapPin />} title="暂无地址" />;
  }

  return (
    <div className={addressCollectionClass}>
      {header}
      {items.length > 0 && (
        <VirtualList
          ref={list}
          label="客户地址列表"
          items={items}
          estimateSize={estimateCardSize}
          renderItem={renderCard}
          retainedIds={retainedIds}
          scrollAnchor={scrollAnchor}
          onReachEnd={hasMore && !request ? loadNext : undefined}
        />
      )}
      {collection && items.length === 0 && !request && (
        <p className="rounded-xl border border-dashed py-9 text-center text-sm text-muted-foreground">
          暂无地址
        </p>
      )}
      {!collection && !request?.error && <AddressCollectionPending />}
      {pageError && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FieldError>{pageError}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryAddresses}
          >
            重试加载地址
          </Button>
        </div>
      )}
      {collection && request && !request.error && (
        <output className="block py-2 text-center text-muted-foreground text-sm">
          正在加载地址…
        </output>
      )}
    </div>
  );
}
