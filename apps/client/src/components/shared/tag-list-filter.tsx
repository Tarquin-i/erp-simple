import { useCallback } from "react";

import { PaginatedFilterOptions } from "@/components/core/filters/components/paginated-filter-options";
import type { PaginatedFilterOptionsQuery } from "@/components/core/filters/components/paginated-filter-options";
import { TagColorDot } from "./tag-color-dot";

export type TagFilterOption = {
  id: string;
  name: string;
  color?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
};
type TagPage = { tags: TagFilterOption[]; total: number };

export function tagFilterLabel(tag: TagFilterOption, showDepartment: boolean) {
  const department =
    tag.departmentName ??
    (tag.departmentId === null ? "未分配部门" : undefined);
  return showDepartment && department
    ? `${tag.name}（${department}）`
    : tag.name;
}

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
  showDepartment,
  ...props
}: {
  loadTags: (
    query: PaginatedFilterOptionsQuery,
    signal: AbortSignal
  ) => Promise<TagPage>;
  showDepartment: boolean;
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
      renderOption={(tag) => {
        const label = tagFilterLabel(tag, showDepartment);
        return (
          <>
            <TagColorDot color={tag.color} />
            <span className="truncate" title={label}>
              {label}
            </span>
          </>
        );
      }}
    />
  );
}
