import { Route, Tag, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetStateAction } from "react";

import type {
  ColumnConfig,
  ColumnOption,
  FiltersState,
} from "@/components/shared/data-table-filter/core/types";
import { useDataTableFilters } from "@/components/shared/data-table-filter";
import { TagListFilter } from "@/components/shared/tag-list-filter";
import { Button } from "@/components/ui/button";
import {
  CustomerApiError,
  getCustomerTag,
  listCustomerChannels,
  listCustomerOwners,
  listCustomerTags,
} from "@/request/customers";
import type {
  Customer,
  CustomerListQuery,
  CustomerTag,
} from "@/request/customers";

import {
  customerFilterLimit,
  customerFilterOperator,
  customerFilterValue,
  customerFilterValues,
} from "../list-query";

type QueryUpdater = (previous: CustomerListQuery) => CustomerListQuery;
type CustomerOptionColumn = ColumnConfig<Customer, "option">;
type DictionaryState = { options?: ColumnOption[]; failed?: boolean };
type TagLabel = { label: string; retryable?: boolean };

const channelField = {
  id: "channelCode",
  operatorKey: "channelOperator",
  displayName: "渠道",
  icon: Route,
  type: "option",
  flatValueOptions: true,
} as const;
const tagField = {
  id: "tagId",
  operatorKey: "tagOperator",
  displayName: "标签",
  icon: Tag,
  type: "option",
  flatValueOptions: true,
} as const;
const ownerField = {
  id: "ownerUserId",
  operatorKey: "ownerOperator",
  displayName: "业务员",
  icon: UserRound,
  type: "option",
  flatValueOptions: true,
} as const;
const filterFields = [channelField, tagField, ownerField];
const serverRows: Customer[] = [];
const dictionaryLoadingText = "正在读取选项…";

async function loadChannelOptions(signal: AbortSignal) {
  const { channels } = await listCustomerChannels(signal);
  return channels.map(({ code, name }) => ({ value: code, label: name }));
}

async function loadOwnerOptions(signal: AbortSignal) {
  const { owners } = await listCustomerOwners(signal);
  return owners.map(({ id, name }) => ({ value: id, label: name }));
}

function useFilterDictionary(
  loadOptions: (signal: AbortSignal) => Promise<ColumnOption[]>
) {
  const [state, setState] = useState<DictionaryState>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void loadOptions(signal).then(
      (options) => {
        if (!signal.aborted) setState({ options });
      },
      () => {
        if (!signal.aborted) setState({ failed: true });
      }
    );
    return () => controller.abort();
  }, [attempt, loadOptions]);

  const retry = useCallback(() => {
    setState({});
    setAttempt((value) => value + 1);
  }, []);

  return [state, retry] as const;
}

function renderDictionaryState(
  { options, failed }: DictionaryState,
  retry: () => void
) {
  if (options) return;
  return () => (
    <div className="flex items-center justify-between gap-2 p-3 text-sm">
      {failed ? (
        <>
          <span role="alert" className="text-destructive">
            暂时无法加载选项。
          </span>
          <Button type="button" variant="outline" size="xs" onClick={retry}>
            重试
          </Button>
        </>
      ) : (
        <span role="status" className="text-muted-foreground">
          {dictionaryLoadingText}
        </span>
      )}
    </div>
  );
}

function readFilters(query: CustomerListQuery): FiltersState {
  return filterFields.flatMap(({ id, type, operatorKey }) => {
    const values = customerFilterValues(query[id]);
    return values.length
      ? [
          {
            columnId: id,
            type,
            operator:
              customerFilterOperator(values.length, query[operatorKey]) ?? "is",
            values,
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
    const values = filter?.values.filter(
      (value: unknown): value is string => typeof value === "string"
    );
    const selected = [...new Set(values)];
    if (selected.length > customerFilterLimit) continue;
    const previous = customerFilterValues(query[id]);
    const operator = customerFilterOperator(selected.length, filter?.operator);
    if (
      query[operatorKey] === operator &&
      previous.length === selected.length &&
      previous.every((value, index) => value === selected[index])
    )
      continue;
    changed = true;
    next[id] = customerFilterValue(selected);
    next[operatorKey] = operator;
  }

  return changed ? { ...next, page: undefined } : query;
}

function withSelectedOptions(
  options: ColumnOption[],
  selected: string[],
  label: string
) {
  const missing = selected.filter(
    (value) => !options.some((option) => option.value === value)
  );
  return [...options, ...missing.map((value) => ({ value, label }))];
}

/** 将客户列表的 URL 参数适配给公共筛选组件。 */
export function useCustomerListFilters(
  query: CustomerListQuery,
  onQueryChange: (update: QueryUpdater) => void,
  pageTags: ReadonlyMap<string, CustomerTag>
) {
  const [channels, retryChannels] = useFilterDictionary(loadChannelOptions);
  const [owners, retryOwners] = useFilterDictionary(loadOwnerOptions);
  const [tagLabels, setTagLabels] = useState<ReadonlyMap<string, TagLabel>>(
    () => new Map()
  );
  const tagIds = useMemo(
    () => customerFilterValues(query.tagId),
    [query.tagId]
  );

  useEffect(() => {
    const missingIds = tagIds.filter(
      (id) => !pageTags.has(id) && !tagLabels.has(id)
    );
    if (!missingIds.length) return;
    const controller = new AbortController();
    void Promise.all(
      missingIds.map(async (id): Promise<[string, TagLabel]> => {
        try {
          const { tag } = await getCustomerTag(id, controller.signal);
          return [id, { label: tag.name }];
        } catch (error) {
          const unavailable =
            error instanceof CustomerApiError && error.status === 404;
          return [
            id,
            {
              label: unavailable ? "所选标签不可用" : "所选标签加载失败",
              retryable: !unavailable,
            },
          ];
        }
      })
    ).then((labels) => {
      if (controller.signal.aborted) return;
      setTagLabels((previous) => new Map([...previous, ...labels]));
    });
    return () => controller.abort();
  }, [pageTags, tagIds, tagLabels]);

  const retryTagLabels = useCallback(() => {
    setTagLabels(
      (previous) => new Map([...previous].filter(([, tag]) => !tag.retryable))
    );
  }, []);

  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) =>
      onQueryChange((previous) => applyFilters(previous, update)),
    [onQueryChange]
  );
  const toggleTag = useCallback(
    (tag: Pick<CustomerTag, "id" | "name">) => {
      setTagLabels((previous) =>
        previous.get(tag.id)?.label === tag.name
          ? previous
          : new Map(previous).set(tag.id, { label: tag.name })
      );
      onQueryChange((previous) => {
        const selected = customerFilterValues(previous.tagId);
        const next = selected.includes(tag.id)
          ? selected.filter((id) => id !== tag.id)
          : [...selected, tag.id];
        if (next.length > customerFilterLimit) return previous;
        return {
          ...previous,
          tagId: customerFilterValue(next),
          tagOperator: customerFilterOperator(
            next.length,
            previous.tagOperator
          ),
          page: undefined,
        };
      });
    },
    [onQueryChange]
  );

  const columnsConfig = useMemo(() => {
    return [
      {
        ...channelField,
        accessor: (customer) => customer.channels.map(({ code }) => code),
        options: withSelectedOptions(
          channels.options ?? [],
          customerFilterValues(query.channelCode),
          channels.options || channels.failed
            ? "所选渠道不可用"
            : dictionaryLoadingText
        ),
        renderFilterValue: renderDictionaryState(channels, retryChannels),
      },
      {
        ...tagField,
        accessor: (customer) => customer.tags.map(({ id }) => id),
        options: tagIds.map((id) => ({
          value: id,
          label:
            pageTags.get(id)?.name ??
            tagLabels.get(id)?.label ??
            "正在读取标签…",
        })),
        renderFilterValue: (filter) => (
          <TagListFilter
            loadTags={listCustomerTags}
            selectionLimit={customerFilterLimit}
            selected={filter?.values ?? []}
            labelLookupFailed={tagIds.some(
              (id) => !pageTags.has(id) && tagLabels.get(id)?.retryable
            )}
            onRetryLabels={retryTagLabels}
            onToggle={toggleTag}
          />
        ),
      },
      {
        ...ownerField,
        accessor: (customer) => customer.ownerUserId,
        options: withSelectedOptions(
          owners.options ?? [],
          customerFilterValues(query.ownerUserId),
          owners.options || owners.failed
            ? "所选业务员不可用"
            : dictionaryLoadingText
        ),
        renderFilterValue: renderDictionaryState(owners, retryOwners),
      },
    ] satisfies CustomerOptionColumn[];
  }, [
    channels,
    owners,
    pageTags,
    query.channelCode,
    query.ownerUserId,
    retryChannels,
    retryOwners,
    retryTagLabels,
    tagIds,
    tagLabels,
    toggleTag,
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
