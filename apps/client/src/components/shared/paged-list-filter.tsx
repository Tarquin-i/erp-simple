import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  FilterMenuCheckbox,
  FilterMenuCommand,
  FilterMenuSearch,
} from "./filter-menu";

type ListOption = { id: string; name: string };
type OptionPage<TOption> = { options: TOption[]; total: number };

export type PagedListFilterQuery = {
  search?: string;
  page: number;
  pageSize: number;
};

type PagedListFilterLabels = {
  searchPlaceholder: string;
  loadingText: string;
  emptyText: string;
  loadErrorText: string;
  labelErrorText: string;
  previousPageLabel: string;
  nextPageLabel: string;
  selectionLimitText: (limit: number) => string;
};

const pageSize = 20;

/** 提供服务端分页和搜索，已选项由当前列表的筛选条件控制。 */
export function PagedListFilter<TOption extends ListOption>({
  loadOptions,
  labels,
  searchMaxLength = 64,
  selectionLimit,
  selected,
  labelLookupFailed,
  onRetryLabels,
  onToggle,
  renderOption = (option) => (
    <span className="truncate" title={option.name}>
      {option.name}
    </span>
  ),
}: {
  loadOptions: (
    query: PagedListFilterQuery,
    signal: AbortSignal
  ) => Promise<OptionPage<TOption>>;
  labels: PagedListFilterLabels;
  searchMaxLength?: number;
  selectionLimit: number;
  selected: string[];
  labelLookupFailed: boolean;
  onRetryLabels: () => void;
  onToggle: (option: TOption) => void;
  renderOption?: (option: TOption) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<OptionPage<TOption>>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyword = search.trim();
  const { loadErrorText } = labels;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(
      () => {
        void loadOptions(
          { search: keyword || undefined, page, pageSize },
          signal
        ).then(
          (next) => {
            if (!signal.aborted) setResult(next);
          },
          (failure: unknown) => {
            if (signal.aborted) return;
            setError(
              failure instanceof Error ? failure.message : loadErrorText
            );
          }
        );
      },
      keyword && page === 1 ? 250 : 0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, loadOptions, loadErrorText, page, retry]);

  function changePage(next: number) {
    // 分页按钮在等待响应时会卸载，焦点留在常驻的搜索框内。
    searchRef.current?.focus({ preventScroll: true });
    setPage(next);
    setResult(undefined);
    setError("");
  }

  return (
    <FilterMenuCommand
      label={labels.searchPlaceholder}
      shouldFilter={false}
      loop
    >
      <FilterMenuSearch
        autoFocus
        ref={searchRef}
        aria-label={labels.searchPlaceholder}
        placeholder={labels.searchPlaceholder}
        maxLength={searchMaxLength}
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          if (value.trim() !== keyword) changePage(1);
        }}
      />
      <CommandList aria-multiselectable="true" className="max-h-60">
        {result?.options.length ? (
          <CommandGroup>
            {result.options.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  aria-checked={checked}
                  className="h-8 rounded-md"
                  disabled={!checked && selected.length >= selectionLimit}
                  onSelect={() => onToggle(option)}
                >
                  <FilterMenuCheckbox checked={checked} />
                  {renderOption(option)}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
      {error ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="text-destructive" role="alert">
            {error}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setError("");
              setRetry((attempt) => attempt + 1);
            }}
          >
            重试
          </Button>
        </div>
      ) : !result?.options.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          {!result ? labels.loadingText : labels.emptyText}
        </p>
      ) : null}
      {labelLookupFailed && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="text-destructive" role="status">
            {labels.labelErrorText}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onRetryLabels}
          >
            重试
          </Button>
        </div>
      )}
      {selected.length >= selectionLimit && (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          {labels.selectionLimitText(selectionLimit)}
        </p>
      )}
      {result && (page > 1 || result.total > pageSize) && (
        <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
          <span>
            第 {page} / {Math.ceil(result.total / pageSize)} 页
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={labels.previousPageLabel}
              disabled={page <= 1}
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={labels.nextPageLabel}
              disabled={page * pageSize >= result.total}
              onClick={() => changePage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </FilterMenuCommand>
  );
}
