import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

import { OptionEditorDialog } from "./option-editor-dialog";
import { SearchableMultiSelect } from "./searchable-multi-select";
import { hasVisibleTagColor } from "./tag-color-dot";

export type PickerOption = { id: string; name: string; color?: string };

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
const defaultTagColor = "#111111";
// 与客户和沟通保存接口的标签数量上限一致。
const maxTags = 100;

type TagPage = {
  keyword: string;
  items: PickerOption[];
  page: number;
  total: number;
};

type TagEditor =
  | { mode: "create"; name: string }
  | { mode: "edit"; tag: PickerOption };

/** 为公共复选框接入标签目录、分页和标签操作。 */
export function TagMultiSelectField({
  onCreatingChange,
  loadTags,
  createTag,
  updateTagColor,
  tagLimitLabel,
  ...props
}: PickerProps & {
  onCreatingChange?: (creating: boolean) => void;
  loadTags: (
    query: { search: string; page: number; pageSize: number },
    signal: AbortSignal
  ) => Promise<{ tags: PickerOption[]; page: number; total: number }>;
  createTag?: (input: {
    name: string;
    color?: string;
  }) => Promise<{ tag: PickerOption }>;
  updateTagColor?: (
    id: string,
    input: { color: string; expectedColor: string }
  ) => Promise<{ tag: PickerOption }>;
  tagLimitLabel?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const returnToOptions = useRef(false);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<TagEditor | null>(null);
  const [tagColor, setTagColor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<TagPage | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [colorConflict, setColorConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const tagLimitId = `${props.id}-limit`;
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
  const editedTag = editor?.mode === "edit" ? editor.tag : null;
  const newTagName = editor?.mode === "create" ? editor.name.trim() : "";
  const expectedColor = editedTag?.color ?? defaultTagColor;
  const nextColor = tagColor ?? defaultTagColor;
  const canSubmitEditor = editedTag
    ? Boolean(updateTagColor) &&
      !colorConflict &&
      nextColor !== expectedColor.toLowerCase()
    : Boolean(createTag && !atTagLimit && newTagName);

  // 仅在下拉打开时查询。搜索首屏防抖，条件变化时取消上一笔请求。
  // biome-ignore lint/correctness/useExhaustiveDependencies(reload): 重新加载当前搜索条件和页码的标签候选。
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
            const next = response.tags;
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

  function editTagColor(tag: PickerOption) {
    setEditorError("");
    setColorConflict(false);
    setTagColor(hasVisibleTagColor(tag.color) ? tag.color.toLowerCase() : null);
    setOpen(false);
    returnToOptions.current = true;
    setEditor({ mode: "edit", tag });
  }

  function refreshTag(tag: PickerOption) {
    const refresh = (items: PickerOption[]) =>
      items.map((option) => (option.id === tag.id ? tag : option));
    if (props.value.some(({ id }) => id === tag.id)) {
      props.onChange(refresh(props.value));
    }
    setResults(
      (current) => current && { ...current, items: refresh(current.items) }
    );
  }

  async function submitTag() {
    if (!canSubmitEditor || saving || props.disabled) return;

    setEditorError("");
    setSaving(true);
    onCreatingChange?.(true);
    try {
      if (editedTag && updateTagColor) {
        const { tag } = await updateTagColor(editedTag.id, {
          color: nextColor,
          expectedColor,
        });
        refreshTag(tag);
      } else if (createTag && newTagName) {
        const { tag } = await createTag({
          name: newTagName,
          color: tagColor ?? undefined,
        });
        if (!props.value.some(({ id }) => id === tag.id)) {
          props.onChange([...props.value, tag]);
        }
        setPage(1);
        setReload((attempt) => attempt + 1);
      }
      returnToOptions.current = true;
      setEditor(null);
    } catch (error) {
      if (
        editedTag &&
        error instanceof Error &&
        "code" in error &&
        error.code === "tag_color_conflict"
      ) {
        const current = "current" in error ? error.current : null;
        if (
          current &&
          typeof current === "object" &&
          "id" in current &&
          current.id === editedTag.id &&
          "color" in current &&
          typeof current.color === "string" &&
          (current.color === defaultTagColor ||
            hasVisibleTagColor(current.color))
        ) {
          refreshTag({ ...editedTag, color: current.color });
        }
        setColorConflict(true);
        setEditorError("颜色已被其他人修改。请关闭弹窗并重新打开后再保存。");
      } else {
        setEditorError(
          error instanceof Error
            ? error.message
            : editedTag
              ? "标签改色失败，请重试。"
              : "标签新建失败，请重试。"
        );
      }
    } finally {
      setSaving(false);
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
        getOptionColor={(option) => option.color}
        onEditOptionColor={updateTagColor ? editTagColor : undefined}
        emptyMessage={
          searchError ||
          (loading || !currentResult ? "正在加载标签…" : "没有匹配的标签")
        }
        disabled={props.disabled || saving}
        descriptionId={atTagLimit ? tagLimitId : undefined}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !returnToOptions.current) changeSearch("");
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
                label: keyword ? `新建标签「${keyword}」` : "新建标签",
                onClick: () => {
                  setEditorError("");
                  setTagColor(null);
                  setEditor({ mode: "create", name: keyword });
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
                disabled={loading || saving}
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
        open={editor !== null}
        title={editedTag ? "修改标签颜色" : "新建标签"}
        description={
          editedTag
            ? "这是共享标签，改色会同步到所有引用它的记录。"
            : "创建后会自动选中这个标签。"
        }
        showDescription={Boolean(editedTag)}
        inputId={props.id + (editedTag ? "-edit-name" : "-new-name")}
        inputLabel="标签名称"
        placeholder="输入标签名称"
        maxLength={64}
        value={
          editor?.mode === "create" ? editor.name : (editedTag?.name ?? "")
        }
        busy={saving}
        disabled={props.disabled}
        submitDisabled={!canSubmitEditor}
        submitLabel={editedTag ? "保存颜色" : "创建"}
        busyLabel={editedTag ? "正在保存…" : "正在创建…"}
        error={editorError}
        color={{
          value: tagColor,
          onChange: setTagColor,
          original: hasVisibleTagColor(expectedColor)
            ? expectedColor.toLowerCase()
            : null,
        }}
        onValueChange={
          editedTag
            ? undefined
            : (name) => {
                setEditor({ mode: "create", name });
                setEditorError("");
              }
        }
        onConfirm={submitTag}
        onOpenChange={(next) => {
          if (!next) setEditor(null);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnToOptions.current) {
            returnToOptions.current = false;
            setOpen(true);
          } else {
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      />
    </Field>
  );
}
