import {
  defaultRangeExtractor,
  type Range,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type VirtualListProps<T extends { id: string }> = {
  label: string;
  items: readonly T[];
  estimateSize: (item: T) => number;
  renderItem: (item: T) => ReactNode;
  onReachEnd?: () => void;
  retainedIds?: ReadonlySet<string>;
  scrollToId?: string;
};

/** 随页面滚动，按记录 ID 保留正在交互的行，并实测展开后的高度。 */
export function VirtualList<T extends { id: string }>({
  label,
  items,
  estimateSize,
  renderItem,
  onReachEnd,
  retainedIds,
  scrollToId,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const lastScrollId = useRef<string | undefined>(undefined);
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
      {virtualizer.getVirtualItems().map((row) => {
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
