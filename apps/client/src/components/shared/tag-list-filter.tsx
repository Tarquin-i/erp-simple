import { useCallback } from "react";

import { PaginatedFilterOptions } from "./paginated-filter-options";
import type { PaginatedFilterOptionsQuery } from "./paginated-filter-options";
import { TagColorDot } from "./tag-color-dot";

export type TagFilterOption = {
  id: string;
  name: string;
  color?: string | null;
};
type TagPage = { tags: TagFilterOption[]; total: number };

const labels = {
  searchPlaceholder: "搜索标签",
  loadingText: "正在加载标签…",
  emptyText: "没有匹配的标签",
  loadErrorText: "暂时无法加载标签。",
  labelErrorText: "所选标签加载失败",
  previousPageLabel: "上一页标签",
  nextPageLabel: "下一页标签",
  selectionLimitText: (limit: number) => `最多选择 ${limit} 项标签`,
};

export function TagListFilter({
  loadTags,
  ...props
}: {
  loadTags: (
    query: PaginatedFilterOptionsQuery,
    signal: AbortSignal
  ) => Promise<TagPage>;
  selectionLimit: number;
  selected: string[];
  labelLookupFailed: boolean;
  onRetryLabels: () => void;
  onToggle: (tag: TagFilterOption) => void;
}) {
  const loadOptions = useCallback(
    async (query: PaginatedFilterOptionsQuery, signal: AbortSignal) => {
      const { tags, total } = await loadTags(query, signal);
      return { options: tags, total };
    },
    [loadTags]
  );

  return (
    <PaginatedFilterOptions
      {...props}
      loadOptions={loadOptions}
      labels={labels}
      renderOption={(tag) => (
        <>
          <TagColorDot color={tag.color} />
          <span className="truncate" title={tag.name}>
            {tag.name}
          </span>
        </>
      )}
    />
  );
}
