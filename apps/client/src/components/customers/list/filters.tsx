import { Route, Tag, UserRound } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ComponentProps, SetStateAction } from "react";

import type {
  ColumnConfig,
  ColumnOption,
  FiltersState,
} from "@/components/data-table-filter/core/types";
import { useDataTableFilters } from "@/components/data-table-filter";
import { Button } from "@/components/ui/button";
import {
  CustomerApiError,
  getCustomerTag,
  listCustomerChannels,
  listCustomerOwners,
} from "@/request/customers";
import type {
  Customer,
  CustomerListQuery,
  CustomerTag,
} from "@/request/customers";

import { TagSelector } from "./tag-selector";

type QueryUpdater = (previous: CustomerListQuery) => CustomerListQuery;
type CustomerOptionColumn = ColumnConfig<Customer, "option">;
type DictionaryOptions = { channels: ColumnOption[]; owners: ColumnOption[] };

const channelField = {
  id: "channelCode",
  operatorKey: "channelOperator",
  displayName: "渠道",
  icon: Route,
  type: "option",
} as const;
const tagField = {
  id: "tagId",
  operatorKey: "tagOperator",
  displayName: "标签",
  icon: Tag,
  type: "option",
} as const;
const ownerField = {
  id: "ownerUserId",
  operatorKey: "ownerOperator",
  displayName: "业务员",
  icon: UserRound,
  type: "option",
} as const;
const filterFields = [channelField, tagField, ownerField];
const serverRows: Customer[] = [];

function readFilters(query: CustomerListQuery): FiltersState {
  return filterFields.flatMap(({ id, type, operatorKey }) => {
    const value = query[id];
    return value
      ? [
          {
            columnId: id,
            type,
            operator: query[operatorKey] ?? "is",
            values: [value],
          },
        ]
      : [];
  });
}

function applyFilters(
  query: CustomerListQuery,
  update: SetStateAction<FiltersState>
) {
  const filters =
    typeof update === "function" ? update(readFilters(query)) : update;
  const next = { ...query };
  let changed = false;

  for (const { id, operatorKey } of filterFields) {
    const filter = filters.find((entry) => entry.columnId === id);
    // 组件会把新选项追加到末尾，客户接口每个字段只接受一个值。
    const value = filter?.values.at(-1);
    const selected = typeof value === "string" ? value : undefined;
    const excluded =
      filter?.operator === "is not" || filter?.operator === "is none of";
    const operator = selected && excluded ? "is not" : undefined;
    if (query[id] !== selected || query[operatorKey] !== operator)
      changed = true;
    next[id] = selected;
    next[operatorKey] = operator;
  }

  return changed ? { ...next, page: undefined } : query;
}

function withSelectedOption(
  options: ColumnOption[],
  value: string | undefined,
  label: string
) {
  if (!value || options.some((option) => option.value === value))
    return options;
  return [...options, { value, label }];
}

function CustomerTagOptions(props: ComponentProps<typeof TagSelector>) {
  const id = useId();
  return (
    <div className="w-56 max-w-full p-2.5">
      <TagSelector {...props} inputId={id} />
    </div>
  );
}

/** 将客户列表的 URL 参数适配给公共筛选组件。 */
export function useCustomerListFilters(
  query: CustomerListQuery,
  onQueryChange: (update: QueryUpdater) => void,
  selectedTag?: CustomerTag
) {
  const [dictionaries, setDictionaries] = useState<DictionaryOptions>();
  const [dictionaryError, setDictionaryError] = useState(false);
  const [dictionaryRetry, setDictionaryRetry] = useState(0);
  const [tagLookup, setTagLookup] = useState<{
    id: string;
    tag?: CustomerTag;
    message?: string;
  }>();
  const tagId = query.tagId;
  const knownTag =
    selectedTag?.id === tagId
      ? selectedTag
      : tagLookup?.id === tagId
        ? tagLookup?.tag
        : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([
      listCustomerChannels(signal),
      listCustomerOwners(signal),
    ]).then(
      ([{ channels }, { owners }]) => {
        if (signal.aborted) return;
        setDictionaries({
          channels: channels.map(({ code, name }) => ({
            value: code,
            label: name,
          })),
          owners: owners.map(({ id, name }) => ({ value: id, label: name })),
        });
      },
      () => {
        if (!signal.aborted) setDictionaryError(true);
      }
    );
    return () => controller.abort();
  }, [dictionaryRetry]);

  const loadTag = useCallback(async (id: string, signal?: AbortSignal) => {
    const result = await getCustomerTag(id, signal);
    if (!signal?.aborted) setTagLookup({ id, tag: result.tag });
    return result;
  }, []);

  useEffect(() => {
    if (!tagId || knownTag) return;
    const controller = new AbortController();
    void loadTag(tagId, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        // 没有命中或所选标签被删除时，保留仍可移除的条件。
        const unavailable =
          error instanceof CustomerApiError && error.status === 404;
        setTagLookup({
          id: tagId,
          message: unavailable ? "所选标签不可用" : "所选标签加载失败",
        });
      }
    });
    return () => controller.abort();
  }, [knownTag, loadTag, tagId]);

  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) =>
      onQueryChange((previous) => applyFilters(previous, update)),
    [onQueryChange]
  );
  const selectTag = useCallback(
    (nextTagId: string | undefined) => {
      onQueryChange((previous) =>
        previous.tagId === nextTagId
          ? previous
          : {
              ...previous,
              tagId: nextTagId,
              tagOperator: nextTagId ? previous.tagOperator : undefined,
              page: undefined,
            }
      );
    },
    [onQueryChange]
  );

  const columnsConfig = useMemo(() => {
    const pending = "正在读取选项…";
    const dictionaryState = dictionaries
      ? undefined
      : () => (
          <div className="flex items-center justify-between gap-2 p-3 text-sm">
            {dictionaryError ? (
              <>
                <span role="alert" className="text-destructive">
                  暂时无法加载选项。
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setDictionaryError(false);
                    setDictionaryRetry((value) => value + 1);
                  }}
                >
                  重试
                </Button>
              </>
            ) : (
              <span role="status" className="text-muted-foreground">
                {pending}
              </span>
            )}
          </div>
        );

    return [
      {
        ...channelField,
        accessor: (customer) => customer.channels.map(({ code }) => code),
        options: withSelectedOption(
          dictionaries?.channels ?? [],
          query.channelCode,
          dictionaries || dictionaryError ? "所选渠道不可用" : pending
        ),
        renderFilterValue: dictionaryState,
      },
      {
        ...tagField,
        accessor: (customer) => customer.tags.map(({ id }) => id),
        options: withSelectedOption(
          [],
          tagId,
          knownTag?.name ??
            (tagLookup?.id === tagId ? tagLookup?.message : undefined) ??
            "正在读取标签…"
        ),
        renderFilterValue: (filter) => (
          <CustomerTagOptions
            tagId={filter?.values[0]}
            selectedTag={knownTag}
            loadTag={loadTag}
            onChange={selectTag}
          />
        ),
      },
      {
        ...ownerField,
        accessor: (customer) => customer.ownerUserId,
        options: withSelectedOption(
          dictionaries?.owners ?? [],
          query.ownerUserId,
          dictionaries || dictionaryError ? "所选业务员不可用" : pending
        ),
        renderFilterValue: dictionaryState,
      },
    ] satisfies CustomerOptionColumn[];
  }, [
    dictionaries,
    dictionaryError,
    knownTag,
    loadTag,
    query.channelCode,
    query.ownerUserId,
    selectTag,
    tagId,
    tagLookup?.id,
    tagLookup?.message,
  ]);

  const filters = useMemo(() => readFilters(query), [query]);
  return useDataTableFilters({
    columnsConfig,
    strategy: "server",
    data: serverRows,
    filters,
    onFiltersChange,
  });
}
