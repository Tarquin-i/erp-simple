import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import {
  FilterMenuCheckbox,
  FilterMenuCommand,
  FilterMenuSearch,
} from "@/components/shared/filter-menu";
import { Button } from "@/components/ui/button";
import {
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { listCustomerTags } from "@/request/customers";
import type { CustomerTag } from "@/request/customers";

import { customerFilterLimit } from "../list-query";

const pageSize = 20;

/** 以服务端原始顺序展示标签候选，翻页和搜索时从同一份列表条件读取勾选状态。 */
export function CustomerTagFilter({
  selected,
  labelLookupFailed,
  onRetryLabels,
  onToggle,
}: {
  selected: string[];
  labelLookupFailed: boolean;
  onRetryLabels: () => void;
  onToggle: (tag: CustomerTag) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof listCustomerTags>>>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const keyword = search.trim();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(
      () => {
        void listCustomerTags(
          { search: keyword || undefined, page, pageSize },
          signal
        ).then(
          (next) => {
            if (!signal.aborted) setResult(next);
          },
          (failure: unknown) => {
            if (signal.aborted) return;
            setError(
              failure instanceof Error ? failure.message : "暂时无法加载标签。"
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
  }, [keyword, page, retry]);

  function changePage(next: number) {
    setPage(next);
    setResult(undefined);
    setError("");
  }

  return (
    <FilterMenuCommand shouldFilter={false} loop>
      <FilterMenuSearch
        autoFocus
        aria-label="搜索标签"
        placeholder="搜索标签"
        maxLength={64}
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          if (value.trim() !== keyword) changePage(1);
        }}
      />
      <CommandList aria-multiselectable="true" className="max-h-60">
        {result?.tags.length ? (
          <CommandGroup>
            {result.tags.map((tag) => {
              const checked = selected.includes(tag.id);
              return (
                <CommandItem
                  key={tag.id}
                  value={tag.id}
                  aria-checked={checked}
                  className="h-8 rounded-md"
                  disabled={!checked && selected.length >= customerFilterLimit}
                  onSelect={() => onToggle(tag)}
                >
                  <FilterMenuCheckbox checked={checked} />
                  <span className="truncate" title={tag.name}>
                    {tag.name}
                  </span>
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
      ) : !result?.tags.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          {!result ? "正在加载标签…" : "没有匹配的标签"}
        </p>
      ) : null}
      {labelLookupFailed && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="text-destructive" role="status">
            所选标签加载失败
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
      {selected.length >= customerFilterLimit && (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          最多选择 {customerFilterLimit} 项标签
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
              aria-label="上一页标签"
              disabled={page <= 1}
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="下一页标签"
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
