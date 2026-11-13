import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  CustomerApiError,
  getCustomerTag,
  listCustomerTags,
} from "@/request/customers";
import type { CustomerTag } from "@/request/customers";

const tagPageSize = 20;

/**
 * 提供可搜索、可分页的单选标签筛选器，并显示已选标签。
 * @param props 已选标签 ID、可复用的标签数据，以及通知选中或清除的回调。
 * @returns 标签筛选界面，请求失败时显示相应提示。
 */
export function TagSelector({
  tagId,
  selectedTag,
  onChange,
}: {
  tagId?: string;
  selectedTag?: CustomerTag;
  onChange: (tagId: string | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const composing = useRef(false);
  const [page, setPage] = useState(1);
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof listCustomerTags>>>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [retainedTag, setRetainedTag] = useState<CustomerTag>();
  const [lookup, setLookup] = useState<{
    id: string;
    tag?: CustomerTag;
    message?: string;
    retryable?: boolean;
  }>();
  const keyword = search.trim();

  // 有搜索词时对第一页请求做防抖，翻页立即查询，条件变化时取消旧请求。
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        listCustomerTags(
          { search: keyword || undefined, page, pageSize: tagPageSize },
          controller.signal
        )
          .then((next) => {
            if (!controller.signal.aborted) setResult(next);
          })
          .catch((failure: unknown) => {
            if (controller.signal.aborted) return;
            setError(
              failure instanceof Error ? failure.message : "暂时无法加载标签。"
            );
          });
      },
      keyword && page === 1 ? 250 : 0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, page, retry]);

  const knownTag =
    [retainedTag, selectedTag, lookup?.tag].find((tag) => tag?.id === tagId) ??
    result?.tags.find((tag) => tag.id === tagId);
  const currentTagLookup = lookup?.id === tagId ? lookup : undefined;
  const needsTagLookup =
    Boolean(result || error) && !knownTag && !currentTagLookup;

  // 已选 ID 在已有数据中找不到时单独补查，返回列表或翻页后仍可显示标签名称。
  useEffect(() => {
    if (!tagId || !needsTagLookup) return;

    const controller = new AbortController();
    getCustomerTag(tagId, controller.signal)
      .then(({ tag }) => {
        if (!controller.signal.aborted) setLookup({ id: tagId, tag });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const missing =
          failure instanceof CustomerApiError && failure.status === 404;
        setLookup({
          id: tagId,
          message: missing ? "所选标签不可用" : "所选标签加载失败",
          retryable: !missing,
        });
      });
    return () => controller.abort();
  }, [tagId, needsTagLookup]);

  function changePage(next: number) {
    setPage(next);
    setResult(undefined);
    setError("");
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor="customer-tag-search">标签</Label>
        {tagId && (
          <div className="flex min-w-0 items-center gap-1">
            <Badge
              variant="secondary"
              className="min-w-0 shrink"
              title={knownTag?.name}
            >
              <span className="truncate">
                {knownTag?.name ??
                  currentTagLookup?.message ??
                  "正在读取所选标签…"}
              </span>
            </Badge>
            {currentTagLookup?.retryable && !knownTag && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setLookup(undefined)}
              >
                重试
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="清除标签筛选"
              onClick={() => {
                setRetainedTag(undefined);
                onChange(undefined);
              }}
            >
              <X />
            </Button>
          </div>
        )}
      </div>
      <Combobox
        inline
        open
        autoHighlight
        filter={null}
        items={result?.tags ?? []}
        inputValue={search}
        value={knownTag ?? null}
        itemToStringLabel={(tag) => tag.name}
        isItemEqualToValue={(tag, current) => tag.id === current.id}
        onInputValueChange={(value, details) => {
          if (details.reason !== "input-change") {
            details.cancel();
            return;
          }
          setSearch(value);
          if (value.trim() !== keyword) changePage(1);
        }}
        onValueChange={(tag, details) => {
          if (!tag) {
            details.cancel();
            return;
          }
          setRetainedTag(tag);
          onChange(tag.id);
        }}
      >
        <ComboboxInput
          id="customer-tag-search"
          aria-label="搜索标签"
          placeholder="搜索标签"
          maxLength={64}
          showTrigger={false}
          className="h-9 w-full [&_[data-slot=input-group-addon]:empty]:hidden"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            // 输入法用回车确认文字时，暂不选中列表中的标签。
            if (
              event.key === "Enter" &&
              (composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            ) {
              event.preventBaseUIHandler();
            }
          }}
        >
          <InputGroupAddon align="inline-start">
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <div className="overflow-hidden rounded-lg border">
          {error ? (
            <div
              className="flex items-center justify-between gap-2 px-2.5 py-2"
              role="alert"
            >
              <span className="text-xs text-destructive">{error}</span>
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
          ) : (
            <ComboboxList className="max-h-36">
              {(tag: CustomerTag) => (
                <ComboboxItem key={tag.id} value={tag}>
                  <span className="truncate">{tag.name}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          )}
          {!error && !result?.tags.length && (
            <p
              className="px-2.5 py-2 text-xs text-muted-foreground"
              role="status"
            >
              {!result ? "正在加载标签…" : "没有匹配的标签"}
            </p>
          )}
          {result && (page > 1 || result.total > tagPageSize) && (
            <div className="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
              <span>
                第 {page} / {Math.ceil(result.total / tagPageSize)} 页
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
                  disabled={page * tagPageSize >= result.total}
                  onClick={() => changePage(page + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </div>
      </Combobox>
    </div>
  );
}
