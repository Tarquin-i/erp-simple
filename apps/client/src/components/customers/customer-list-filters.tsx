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
import { PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CustomerApiError,
  getCustomerTag,
  listCustomerChannels,
  listCustomerOwners,
  listCustomerTags,
} from "@/request/customers";
import type {
  CustomerChannel,
  CustomerListQuery,
  CustomerOwner,
  CustomerTag,
} from "@/request/customers";

type Filters = Pick<CustomerListQuery, "channelCode" | "tagId" | "ownerUserId">;

const allValues = "__all__";
const tagPageSize = 20;

export function CustomerListFilters({
  filters,
  selectedTag,
  onApply,
}: {
  filters: Filters;
  selectedTag?: CustomerTag;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [options, setOptions] = useState<{
    channels: CustomerChannel[];
    owners: CustomerOwner[];
  }>();
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listCustomerChannels(controller.signal),
      listCustomerOwners(controller.signal),
    ])
      .then(([{ channels }, { owners }]) => {
        if (!controller.signal.aborted) setOptions({ channels, owners });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOptionsError(
          error instanceof Error ? error.message : "暂时无法加载筛选选项。"
        );
      });
    return () => controller.abort();
  }, [optionsRetry]);

  return (
    <div role="form" aria-label="客户筛选">
      <PopoverHeader className="border-b px-4 py-3">
        <PopoverTitle>筛选客户</PopoverTitle>
      </PopoverHeader>
      <div className="space-y-4 p-4">
        {optionsError && (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-xs text-destructive">{optionsError}</p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setOptionsError("");
                setOptionsRetry((value) => value + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FilterSelect
            id="customer-channel-filter"
            label="渠道"
            allLabel="全部渠道"
            value={draft.channelCode}
            items={(options?.channels ?? []).map(({ code, name }) => ({
              id: code,
              name,
            }))}
            disabled={!options}
            pending={!options && !optionsError}
            onChange={(channelCode) =>
              setDraft((prev) => ({ ...prev, channelCode }))
            }
          />
          <FilterSelect
            id="customer-owner-filter"
            label="业务员"
            allLabel="全部业务员"
            value={draft.ownerUserId}
            items={options?.owners ?? []}
            disabled={!options}
            pending={!options && !optionsError}
            onChange={(ownerUserId) =>
              setDraft((prev) => ({ ...prev, ownerUserId }))
            }
          />
        </div>
        <TagFilter
          value={draft.tagId}
          selectedTag={selectedTag}
          onChange={(tagId) => setDraft((prev) => ({ ...prev, tagId }))}
        />
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <Button type="button" variant="ghost" onClick={() => onApply({})}>
          重置
        </Button>
        <Button type="button" onClick={() => onApply(draft)}>
          应用筛选
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  items,
  disabled,
  pending,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value?: string;
  items: Array<{ id: string; name: string }>;
  disabled: boolean;
  pending: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const missing = value && !items.some((item) => item.id === value);

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        disabled={disabled}
        value={value ?? allValues}
        onValueChange={(next) =>
          onChange(next === allValues ? undefined : next)
        }
      >
        <SelectTrigger id={id} className="w-full data-[size=default]:h-9">
          {pending ? (
            <span className="text-muted-foreground">正在加载…</span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValues}>{allLabel}</SelectItem>
          {missing && <SelectItem value={value}>已选{label}</SelectItem>}
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TagFilter({
  value,
  selectedTag,
  onChange,
}: {
  value?: string;
  selectedTag?: CustomerTag;
  onChange: (value: string | undefined) => void;
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
    [retainedTag, selectedTag, lookup?.tag].find((tag) => tag?.id === value) ??
    result?.tags.find((tag) => tag.id === value);
  const lookupError = lookup?.id === value ? lookup : undefined;
  const needsTagLookup = Boolean(result || error) && !knownTag && !lookupError;

  useEffect(() => {
    if (!value || !needsTagLookup) return;

    const controller = new AbortController();
    getCustomerTag(value, controller.signal)
      .then(({ tag }) => {
        if (!controller.signal.aborted) setLookup({ id: value, tag });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const missing =
          failure instanceof CustomerApiError && failure.status === 404;
        setLookup({
          id: value,
          message: missing ? "所选标签不可用" : "所选标签加载失败",
          retryable: !missing,
        });
      });
    return () => controller.abort();
  }, [value, needsTagLookup]);

  function changePage(next: number) {
    setPage(next);
    setResult(undefined);
    setError("");
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor="customer-tag-search">标签</Label>
        {value && (
          <div className="flex min-w-0 items-center gap-1">
            <Badge
              variant="secondary"
              className="min-w-0 shrink"
              title={knownTag?.name}
            >
              <span className="truncate">
                {knownTag?.name ?? lookupError?.message ?? "正在读取所选标签…"}
              </span>
            </Badge>
            {lookupError?.retryable && !knownTag && (
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
