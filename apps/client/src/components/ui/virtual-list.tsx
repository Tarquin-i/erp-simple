import {
  defaultRangeExtractor,
  type Range,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type VirtualScrollAnchor = { id: string; top: number };
export type VirtualListHandle = {
  getScrollAnchor: (
    matches: (id: string) => boolean
  ) => VirtualScrollAnchor | undefined;
};

type VirtualListProps<T extends { id: string }> = {
  ref?: Ref<VirtualListHandle>;
  label: string;
  items: readonly T[];
  estimateSize: (item: T) => number;
  renderItem: (item: T) => ReactNode;
  onReachEnd?: () => void;
  retainedIds?: ReadonlySet<string>;
  scrollToId?: string;
  scrollAnchor?: VirtualScrollAnchor;
};

/** 随页面滚动，按记录 ID 保留正在交互的行，并实测展开后的高度。 */
export function VirtualList<T extends { id: string }>({
  ref,
  label,
  items,
  estimateSize,
  renderItem,
  onReachEnd,
  retainedIds,
  scrollToId,
  scrollAnchor,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const lastScrollId = useRef<string | undefined>(undefined);
  const restoredAnchor = useRef<VirtualScrollAnchor>(undefined);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const itemIndices = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items]
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measureOffset = () => {
      setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
    };
    measureOffset();
    const observer = new ResizeObserver(measureOffset);
    observer.observe(list);
    const main = list.closest("main");
    if (main) observer.observe(main);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getScrollAnchor(matches) {
        const list = listRef.current;
        if (!list || list.getBoundingClientRect().top >= 0) return;
        for (const row of list.children) {
          const item = items[Number(row.getAttribute("data-index"))];
          if (!item || !matches(item.id)) continue;
          const { top, bottom } = row.getBoundingClientRect();
          if (bottom > 0 && top < window.innerHeight)
            return { id: item.id, top };
        }
      },
    }),
    [items]
  );

  const getItemKey = useCallback(
    (index: number) => items[index]?.id ?? index,
    [items]
  );
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indices = new Set(defaultRangeExtractor(range));
      for (const id of retainedIds ?? []) {
        const index = itemIndices.get(id);
        if (index !== undefined) indices.add(index);
      }
      const focusedIndex = focusedId ? itemIndices.get(focusedId) : undefined;
      if (focusedIndex !== undefined) indices.add(focusedIndex);
      return [...indices].sort((a, b) => a - b);
    },
    [focusedId, itemIndices, retainedIds]
  );
  const virtualizer = useWindowVirtualizer<HTMLLIElement>({
    count: items.length,
    getItemKey,
    estimateSize: (index) => estimateSize(items[index]),
    gap: 12,
    overscan: 3,
    scrollMargin,
    rangeExtractor,
  });
  const visibleEnd = virtualizer.range?.endIndex;
  const rows = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    if (!scrollAnchor || restoredAnchor.current === scrollAnchor) return;
    const index = itemIndices.get(scrollAnchor.id);
    if (index === undefined) return;
    // Virtual positions include the list's offset within the page.
    const position = virtualizer.measurementsCache[index]?.start;
    if (position === undefined) return;
    restoredAnchor.current = scrollAnchor;
    window.scrollTo({ top: position - scrollAnchor.top, behavior: "instant" });
  }, [itemIndices, scrollAnchor, virtualizer]);

  useEffect(() => {
    if (visibleEnd !== undefined && visibleEnd >= items.length - 3) {
      onReachEnd?.();
    }
  }, [items.length, onReachEnd, visibleEnd]);

  useEffect(() => {
    if (!scrollToId) {
      lastScrollId.current = undefined;
      return;
    }
    const index = itemIndices.get(scrollToId);
    if (index === undefined || lastScrollId.current === scrollToId) return;
    lastScrollId.current = scrollToId;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [itemIndices, scrollToId, virtualizer]);

  return (
    <ul
      ref={listRef}
      aria-label={label}
      className="relative [overflow-anchor:none]"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => {
        const item = items[row.index];
        return (
          <li
            key={item.id}
            data-index={row.index}
            aria-posinset={row.index + 1}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            onFocusCapture={() => setFocusedId(item.id)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setFocusedId((current) =>
                  current === item.id ? null : current
                );
              }
            }}
          >
            {renderItem(item)}
          </li>
        );
      })}
    </ul>
  );
}
