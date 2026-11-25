import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

import { OptionEditorDialog } from "./option-editor-dialog";
import { SearchableMultiSelect } from "./searchable-multi-select";

export type PickerOption = { id: string; name: string };

type PickerProps = {
  id: string;
  label: string;
  value: PickerOption[];
  onChange: (value: PickerOption[]) => void;
  disabled: boolean;
};

export function FixedMultiSelectField({
  items,
  emptyMessage,
  ...props
}: PickerProps & { items: PickerOption[]; emptyMessage: string }) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id} preventControlActivation>
        {props.label}
      </FieldLabel>
      <SearchableMultiSelect
        {...props}
        items={items}
        emptyMessage={emptyMessage}
        allowClear
      />
    </Field>
  );
}

const tagPageSize = 25;
// 与客户和沟通保存接口的标签数量上限一致。
const maxTags = 100;

type TagPage = {
  keyword: string;
  items: PickerOption[];
  page: number;
  total: number;
};

/** 为公共复选框接入标签目录、分页和创建接口。 */
export function TagMultiSelectField({
  onCreatingChange,
  loadTags,
  createTag,
  tagLimitLabel,
  ...props
}: PickerProps & {
  onCreatingChange?: (creating: boolean) => void;
  loadTags: (
    query: { search: string; page: number; pageSize: number },
    signal: AbortSignal
  ) => Promise<{ tags: PickerOption[]; page: number; total: number }>;
  createTag?: (input: { name: string }) => Promise<{ tag: PickerOption }>;
  tagLimitLabel?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const returnToOptions = useRef(false);
  const [open, setOpen] = useState(false);
  const [tagName, setTagName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<TagPage | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const tagLimitId = props.id + "-limit";
  const atTagLimit = props.value.length >= maxTags;
  const keyword = search.trim();
  const currentResult = results?.keyword === keyword ? results : null;
  const matchingTags = currentResult?.items ?? [];
  const exactMatch = [...matchingTags, ...props.value].some(
    (option) => option.name.toLowerCase() === keyword.toLowerCase()
  );
  const showCreate =
    createTag &&
    !atTagLimit &&
    (!keyword || (currentResult && !loading && !exactMatch && !searchError));

  // 仅在下拉打开时查询。搜索首屏防抖，条件变化时取消上一笔请求。
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setLoading(true);
    setSearchError("");
    const timer = window.setTimeout(
      () => {
        loadTags(
          { search: keyword, page, pageSize: tagPageSize },
          controller.signal
        )
          .then((response) => {
            if (controller.signal.aborted) return;
            const next = response.tags.map(({ id, name }) => ({ id, name }));
            setResults((previous) => ({
              keyword,
              items:
                page > 1 && previous?.keyword === keyword
                  ? [
                      ...new Map(
                        [...previous.items, ...next].map((option) => [
                          option.id,
                          option,
                        ])
                      ).values(),
                    ]
                  : next,
              page: response.page,
              total: response.total,
            }));
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setSearchError("标签加载失败，请重试。");
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      page === 1 && keyword ? 200 : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, loadTags, open, page, reload]);

  function changeSearch(value: string) {
    if (value.trim() !== keyword) setPage(1);
    setSearch(value);
  }

  async function submitTag() {
    const name = tagName?.trim();
    if (!createTag || !name || creating || atTagLimit) return;

    setCreateError("");
    setCreating(true);
    onCreatingChange?.(true);
    try {
      const { tag } = await createTag({ name });
      if (!props.value.some(({ id }) => id === tag.id)) {
        props.onChange([...props.value, { id: tag.id, name: tag.name }]);
      }
      setPage(1);
      setReload((attempt) => attempt + 1);
      returnToOptions.current = true;
      setTagName(null);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "标签新建失败，请重试。"
      );
    } finally {
      setCreating(false);
      onCreatingChange?.(false);
    }
  }

  const hasMore =
    currentResult && currentResult.page * tagPageSize < currentResult.total;

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id} preventControlActivation>
        {props.label}
      </FieldLabel>
      <SearchableMultiSelect
        {...props}
        items={matchingTags}
        emptyMessage={
          searchError ||
          (loading || !currentResult ? "正在加载标签…" : "没有匹配的标签")
        }
        disabled={props.disabled || creating}
        descriptionId={atTagLimit ? tagLimitId : undefined}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) changeSearch("");
        }}
        triggerRef={trigger}
        search={{
          placeholder: "搜索标签",
          query: search,
          onQueryChange: changeSearch,
        }}
        isOptionDisabled={(option) =>
          atTagLimit && !props.value.some(({ id }) => id === option.id)
        }
        allowClear
        action={
          showCreate
            ? {
                label: keyword ? "新建标签「" + keyword + "」" : "新建标签",
                onClick: () => {
                  setCreateError("");
                  setTagName(keyword);
                },
              }
            : undefined
        }
        footer={
          (searchError || hasMore) && (
            <div className="shrink-0 border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading || creating}
                onClick={() => {
                  if (searchError) setReload((attempt) => attempt + 1);
                  else if (currentResult) setPage(currentResult.page + 1);
                }}
              >
                {searchError
                  ? "重试加载标签"
                  : loading
                    ? "正在加载…"
                    : "加载更多标签"}
              </Button>
            </div>
          )
        }
      />
      {atTagLimit && (
        <FieldDescription id={tagLimitId} role="status">
          {tagLimitLabel}最多可选 {maxTags} 个标签。移除已有标签后可继续选择。
        </FieldDescription>
      )}
      <OptionEditorDialog
        open={tagName !== null}
        title="新建标签"
        description="创建后会自动选中这个标签。"
        inputId={props.id + "-new-name"}
        inputLabel="标签名称"
        placeholder="输入标签名称"
        maxLength={64}
        value={tagName ?? ""}
        busy={creating}
        disabled={props.disabled}
        submitDisabled={atTagLimit || !tagName?.trim()}
        submitLabel="创建"
        busyLabel="正在创建…"
        error={createError}
        onValueChange={(value) => {
          setTagName(value);
          setCreateError("");
        }}
        onConfirm={submitTag}
        onOpenChange={(next) => {
          if (!next) setTagName(null);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
          if (returnToOptions.current) {
            returnToOptions.current = false;
            setOpen(true);
          }
        }}
      />
    </Field>
  );
}
