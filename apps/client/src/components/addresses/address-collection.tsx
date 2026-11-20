import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { VirtualList } from "@/components/ui/virtual-list";
import {
  AddressApiError,
  type AddressDetail,
  type AddressListItem,
  listCustomerAddresses,
} from "@/request/addresses";

import { AddressCard, type AddressCardDetailResult } from "./address-card";
import { AddressCollectionPending, addressCollectionClass } from "./load-state";

type AddressPage = Awaited<ReturnType<typeof listCustomerAddresses>>;
type AddressCollectionProps = {
  customerId: string;
  header?: ReactNode;
  currentAddress?: AddressDetail;
  onChanged?: (address: AddressDetail) => Promise<boolean | undefined>;
};

type PageRequest = { page: number; error?: string };

const estimateCardSize = () => 112;

/**
 * 逐批读取一个客户的有效地址，滚动时只渲染附近卡片并保留已展开的状态。
 * @param props 客户 ID、可选标题、当前地址详情及写入后回调。
 * @returns 客户地址列表、加载状态和失败重试入口。
 */
export function AddressCollection({
  customerId,
  header,
  currentAddress,
  onChanged,
}: AddressCollectionProps) {
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [collection, setCollection] = useState<AddressPage>();
  const [request, setRequest] = useState<PageRequest | undefined>({ page: 1 });
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  );
  const [details, setDetails] = useState<
    ReadonlyMap<string, AddressCardDetailResult>
  >(() => new Map());
  const [retainedIds, setRetainedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const loadPage = useCallback(
    async (page: number) => {
      active.current?.abort();
      const controller = new AbortController();
      const { signal } = controller;
      active.current = controller;
      setRequest({ page });
      try {
        const result = await listCustomerAddresses(
          customerId,
          { page },
          signal
        );
        if (signal.aborted) return;
        setCollection((previous) => {
          if (!previous || page === 1) return result;
          const items = new Map(
            previous.addresses.map((item) => [item.id, item])
          );
          for (const item of result.addresses) items.set(item.id, item);
          return { ...result, addresses: [...items.values()] };
        });
        setRequest(undefined);
      } catch (failure) {
        if (signal.aborted) return;
        if (
          failure instanceof AddressApiError &&
          [401, 403, 404].includes(failure.status)
        ) {
          setCollection(undefined);
          setDetails(new Map());
          setRequest({ page: 1, error: failure.message });
          return;
        }
        setRequest({
          page,
          error:
            (failure instanceof Error && failure.message) ||
            "暂时无法加载地址。",
        });
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
    [customerId]
  );

  useEffect(() => {
    mounted.current = true;
    void loadPage(1);
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [loadPage]);

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

  async function refreshAfterChange(address: AddressDetail) {
    if (!mounted.current || (await onChanged?.(address)) === false) return;
    // 默认标记和修改时间会改变排序，废弃旧批次，重新开始追加。
    if (mounted.current) await loadPage(1);
  }

  const hasMore = Boolean(
    collection && collection.page * collection.pageSize < collection.total
  );
  const loadNext = useCallback(() => {
    if (collection && hasMore && !active.current && !request)
      void loadPage(collection.page + 1);
  }, [collection, hasMore, loadPage, request]);

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

  return (
    <div className={addressCollectionClass}>
      {header}
      {items.length > 0 && (
        <VirtualList
          label="客户地址列表"
          items={items}
          estimateSize={estimateCardSize}
          renderItem={renderCard}
          retainedIds={retainedIds}
          onReachEnd={hasMore && !request ? loadNext : undefined}
        />
      )}
      {collection && items.length === 0 && !request && (
        <p className="rounded-xl border border-dashed py-9 text-center text-sm text-muted-foreground">
          暂无地址
        </p>
      )}
      {!collection && !request?.error && <AddressCollectionPending />}
      {request?.error ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FieldError>{request.error}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadPage(request.page)}
          >
            重试加载地址
          </Button>
        </div>
      ) : collection && request ? (
        <output className="block py-2 text-center text-muted-foreground text-sm">
          正在加载地址…
        </output>
      ) : null}
    </div>
  );
}
