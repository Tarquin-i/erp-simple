import { useCallback } from "react";

import { PagedListFilter } from "./paged-list-filter";
import type { PagedListFilterQuery } from "./paged-list-filter";

type TagOption = { id: string; name: string };
type TagPage = { tags: TagOption[]; total: number };

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
    query: PagedListFilterQuery,
    signal: AbortSignal
  ) => Promise<TagPage>;
  selectionLimit: number;
  selected: string[];
  labelLookupFailed: boolean;
  onRetryLabels: () => void;
  onToggle: (tag: TagOption) => void;
}) {
  const loadOptions = useCallback(
    async (query: PagedListFilterQuery, signal: AbortSignal) => {
      const { tags, total } = await loadTags(query, signal);
      return { options: tags, total };
    },
    [loadTags]
  );

  return (
    <PagedListFilter {...props} loadOptions={loadOptions} labels={labels} />
  );
}
