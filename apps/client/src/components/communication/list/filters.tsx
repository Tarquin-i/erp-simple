import { ListChecks, Tag, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode, SetStateAction } from "react";

import { useDataTableFilters } from "@/components/shared/data-table-filter";
import type {
  ColumnConfig,
  ColumnOption,
  FiltersState,
} from "@/components/shared/data-table-filter/core/types";
import { ListFilterToolbar } from "@/components/shared/list-filter-toolbar";
import {
  hasVisibleTagColor,
  TagColorDot,
} from "@/components/shared/tag-color-dot";
import { TagListFilter } from "@/components/shared/tag-list-filter";
import type { TagFilterOption } from "@/components/shared/tag-list-filter";
import { Button } from "@/components/ui/button";
import {
  listOptionLimit,
  listOptionOperator,
  listOptionValue,
  listOptionValues,
} from "@/lib/list-option-query";
import {
  CommunicationApiError,
  communicationStatusLabels,
  getCommunicationTag,
  listCommunicationOwners,
  listCommunicationTags,
} from "@/request/communication";
import type {
  CommunicationListItem,
  CommunicationListQuery,
} from "@/request/communication";

import { parseCommunicationListQuery } from "./query";

type QueryUpdater = (
  previous: CommunicationListQuery
) => CommunicationListQuery;
type OptionColumn = ColumnConfig<CommunicationListItem, "option">;
type TagLabel = { label: string; color?: string | null; retryable?: boolean };

const statusField = {
  id: "status",
  operatorKey: "statusOperator",
  displayName: "状态",
  icon: ListChecks,
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
  accessor: (record: CommunicationListItem) => record.tags.map(({ id }) => id),
} as const;
const ownerField = {
  id: "ownerUserId",
  operatorKey: "ownerOperator",
  displayName: "业务员",
  icon: UserRound,
  type: "option",
  flatValueOptions: true,
} as const;
const filterFields = [statusField, tagField, ownerField];
const statusOptions = Object.entries(communicationStatusLabels).map(
  ([value, label]) => ({ value, label })
);
const serverRows: CommunicationListItem[] = [];

function readFilters(query: CommunicationListQuery): FiltersState {
  return filterFields.flatMap(({ id, type, operatorKey }) => {
    const values = listOptionValues(query[id]);
    return values.length
      ? [
          {
            columnId: id,
            type,
            operator:
              listOptionOperator(values.length, query[operatorKey]) ?? "is",
            values,
          },
        ]
      : [];
  });
}

function applyFilters(
  query: CommunicationListQuery,
  update: SetStateAction<FiltersState>
) {
  const filters =
    typeof update === "function" ? update(readFilters(query)) : update;
  const next: Record<string, unknown> = { ...query };
  let changed = false;

  for (const { id, operatorKey } of filterFields) {
    const filter = filters.find((entry) => entry.columnId === id);
    const selected = [
      ...new Set(filter?.values.filter((value) => typeof value === "string")),
    ];
    if (selected.length > listOptionLimit) continue;
    const previous = listOptionValues(query[id]);
    const operator = listOptionOperator(selected.length, filter?.operator);
    if (
      query[operatorKey] === operator &&
      previous.length === selected.length &&
      previous.every((value, index) => value === selected[index])
    )
      continue;
    changed = true;
    next[id] = listOptionValue(selected);
    next[operatorKey] = operator;
  }

  return changed
    ? parseCommunicationListQuery({ ...next, page: undefined })
    : query;
}

/** 把独立沟通列表的 URL 与服务端候选项接入公共筛选工具栏。 */
export function CommunicationFilterToolbar({
  query,
  onQueryChange,
  records,
  search,
  actions,
}: {
  query: CommunicationListQuery;
  onQueryChange: (update: QueryUpdater) => void;
  records?: CommunicationListItem[];
  search: ReactNode;
  actions: ReactNode;
}) {
  const [owners, setOwners] = useState<ColumnOption[]>();
  const [ownerError, setOwnerError] = useState(false);
  const [ownerRetry, setOwnerRetry] = useState(0);
  const [tagLabels, setTagLabels] = useState<ReadonlyMap<string, TagLabel>>(
    () => new Map()
  );
  const tagIds = useMemo(() => listOptionValues(query.tagId), [query.tagId]);
  const pageTags = useMemo(
    () =>
      new Map(
        records?.flatMap(({ tags }) =>
          tags.map((tag) => [tag.id, tag] as const)
        )
      ),
    [records]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies(ownerRetry): 重试时重新读取沟通筛选的业务员候选。
  useEffect(() => {
    const controller = new AbortController();
    void listCommunicationOwners(controller.signal).then(
      ({ owners }) => {
        if (!controller.signal.aborted) {
          setOwners(owners.map(({ id, name }) => ({ value: id, label: name })));
        }
      },
      () => {
        if (!controller.signal.aborted) setOwnerError(true);
      }
    );
    return () => controller.abort();
  }, [ownerRetry]);

  useEffect(() => {
    const missingIds = tagIds.filter(
      (id) => !pageTags.has(id) && !tagLabels.has(id)
    );
    if (!missingIds.length) return;
    const controller = new AbortController();
    void Promise.all(
      missingIds.map(async (id): Promise<[string, TagLabel]> => {
        try {
          const { tag } = await getCommunicationTag(id, controller.signal);
          return [id, { label: tag.name, color: tag.color }];
        } catch (error) {
          const unavailable =
            error instanceof CommunicationApiError && error.status === 404;
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
      if (!controller.signal.aborted) {
        setTagLabels((previous) => new Map([...previous, ...labels]));
      }
    });
    return () => controller.abort();
  }, [tagIds, pageTags, tagLabels]);

  const onFiltersChange = useCallback(
    (update: SetStateAction<FiltersState>) =>
      onQueryChange((previous) => applyFilters(previous, update)),
    [onQueryChange]
  );
  const toggleTag = useCallback(
    (tag: TagFilterOption) => {
      setTagLabels((previous) => {
        const current = previous.get(tag.id);
        return current?.label === tag.name && current.color === tag.color
          ? previous
          : new Map(previous).set(tag.id, {
              label: tag.name,
              color: tag.color,
            });
      });
      onQueryChange((previous) => {
        const selected = listOptionValues(previous.tagId);
        const next = selected.includes(tag.id)
          ? selected.filter((id) => id !== tag.id)
          : [...selected, tag.id];
        if (next.length > listOptionLimit) return previous;
        return {
          ...previous,
          tagId: listOptionValue(next),
          tagOperator: listOptionOperator(next.length, previous.tagOperator),
          page: undefined,
        };
      });
    },
    [onQueryChange]
  );

  const columnsConfig = useMemo(() => {
    const pending = "正在读取选项…";
    const missingOwners = listOptionValues(query.ownerUserId).filter(
      (id) => !owners?.some(({ value }) => value === id)
    );
    return [
      {
        ...statusField,
        accessor: (record) => record.status,
        options: statusOptions,
      },
      {
        ...tagField,
        options: tagIds.map((id) => {
          const tag = pageTags.get(id);
          const cached = tagLabels.get(id);
          const color = tag ? tag.color : cached?.color;
          return {
            value: id,
            label: tag?.name ?? cached?.label ?? "正在读取标签…",
            icon: hasVisibleTagColor(color) ? (
              <TagColorDot color={color} />
            ) : undefined,
          };
        }),
        renderFilterValue: (filter) => (
          <TagListFilter
            loadTags={listCommunicationTags}
            selectionLimit={listOptionLimit}
            selected={filter?.values ?? []}
            labelLookupFailed={tagIds.some(
              (id) => !pageTags.has(id) && tagLabels.get(id)?.retryable
            )}
            onRetryLabels={() =>
              setTagLabels(
                (previous) =>
                  new Map([...previous].filter(([, tag]) => !tag.retryable))
              )
            }
            onToggle={toggleTag}
          />
        ),
      },
      {
        ...ownerField,
        // 业务员 ID 由候选接口提供，列表记录只包含业务员名称。
        accessor: () => undefined,
        options: [
          ...(owners ?? []),
          ...missingOwners.map((id) => ({
            value: id,
            label: owners || ownerError ? "所选业务员不可用" : pending,
          })),
        ],
        renderFilterValue: owners
          ? undefined
          : () => (
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                {ownerError ? (
                  <>
                    <span role="alert" className="text-destructive">
                      暂时无法加载选项。
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setOwnerError(false);
                        setOwnerRetry((attempt) => attempt + 1);
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
            ),
      },
    ] satisfies OptionColumn[];
  }, [
    owners,
    ownerError,
    query.ownerUserId,
    pageTags,
    tagIds,
    tagLabels,
    toggleTag,
  ]);

  const filters = useMemo(() => readFilters(query), [query]);
  const filterModel = useDataTableFilters({
    columnsConfig,
    strategy: "server",
    data: serverRows,
    filters,
    onFiltersChange,
  });

  return (
    <ListFilterToolbar
      title="沟通"
      search={search}
      actions={actions}
      filterModel={filterModel}
    />
  );
}
