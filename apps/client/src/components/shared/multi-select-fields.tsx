import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

import { OptionEditorDialog } from "./option-editor-dialog";
import { SearchableMultiSelect } from "./searchable-multi-select";
import { hasVisibleTagColor } from "./tag-color-dot";
import { toastManager } from "./toast";

export type PickerOption = { id: string; name: string; color?: string };
type TagPickerOption = PickerOption & { canManage?: boolean };

type PickerProps<Option extends PickerOption = PickerOption> = {
  id: string;
  label: string;
  value: Option[];
  onChange: (value: Option[]) => void;
  disabled: boolean;
  placeholder?: string;
};

export function FixedMultiSelectField({
  items,
  emptyMessage,
  ...props
}: PickerProps & {
  items: PickerOption[];
  emptyMessage: string;
  optionIcon?: ReactNode;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id} preventControlActivation>
        {props.label}
      </FieldLabel>
      <SearchableMultiSelect
        {...props}
        items={items}
        emptyMessage={emptyMessage}
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
  items: TagPickerOption[];
  page: number;
  total: number;
};

type TagEditor =
  | { mode: "create"; name: string }
  | { mode: "edit"; tag: TagPickerOption; name: string }
  | { mode: "delete"; tag: TagPickerOption };

type TagSnapshot = { expectedName: string; expectedColor: string };

/** 为公共复选框接入标签目录、分页和标签操作。 */
export function TagMultiSelectField({
  departmentId,
  onCreatingChange,
  loadTags,
  createTag,
  manageTags,
  tagLimitLabel,
  ...props
}: PickerProps<TagPickerOption> & {
  departmentId: string | undefined;
  onCreatingChange?: (creating: boolean) => void;
  loadTags: (
    query: {
      search: string;
      page: number;
      pageSize: number;
      departmentId: string;
    },
    signal: AbortSignal
  ) => Promise<{ tags: TagPickerOption[]; page: number; total: number }>;
  createTag?: (input: {
    name: string;
    color?: string;
    departmentId: string;
  }) => Promise<{ tag: TagPickerOption }>;
  manageTags: {
    update: (
      id: string,
      input: TagSnapshot & { name: string; color: string }
    ) => Promise<{ tag: TagPickerOption }>;
    usage: (id: string, signal: AbortSignal) => Promise<{ references: number }>;
    remove: (id: string, input: TagSnapshot) => Promise<{ deleted: true }>;
  };
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
  const [tagConflict, setTagConflict] = useState(false);
  const [references, setReferences] = useState<number | null>(null);
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
  const deletingTag = editor?.mode === "delete" ? editor.tag : null;
  const tagName = editor && editor.mode !== "delete" ? editor.name.trim() : "";
  const expectedColor = (editedTag ?? deletingTag)?.color ?? defaultTagColor;
  const nextColor = tagColor ?? defaultTagColor;
  const canSubmitEditor = editedTag
    ? Boolean(editedTag.canManage && tagName && !tagConflict) &&
      (tagName !== editedTag.name || nextColor !== expectedColor.toLowerCase())
    : Boolean(createTag && !atTagLimit && tagName);
  const loadUsage = manageTags.usage;

  useEffect(() => {
    if (!deletingTag) return;
    const controller = new AbortController();
    loadUsage(deletingTag.id, controller.signal)
      .then(({ references }) => {
        if (!controller.signal.aborted) setReferences(references);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setEditorError(
            error instanceof Error
              ? error.message
              : "无法确认标签是否被引用，请重试。"
          );
        }
      });
    return () => controller.abort();
  }, [deletingTag, loadUsage]);

  // 仅在下拉打开时查询。搜索首屏防抖，条件变化时取消上一笔请求。
  // biome-ignore lint/correctness/useExhaustiveDependencies(reload): 重新加载当前搜索条件和页码的标签候选。
  useEffect(() => {
    if (!open || !departmentId) return;

    const controller = new AbortController();
    setLoading(true);
    setSearchError("");
    const timer = window.setTimeout(
      () => {
        loadTags(
          { search: keyword, page, pageSize: tagPageSize, departmentId },
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
  }, [departmentId, keyword, loadTags, open, page, reload]);

  function changeSearch(value: string) {
    if (value.trim() !== keyword) setPage(1);
    setSearch(value);
  }

  function manageTag(tag: TagPickerOption, action: "edit" | "delete") {
    setEditorError("");
    setTagConflict(false);
    setReferences(null);
    setTagColor(hasVisibleTagColor(tag.color) ? tag.color.toLowerCase() : null);
    returnToOptions.current = open;
    setOpen(false);
    setEditor(
      action === "edit"
        ? { mode: "edit", tag, name: tag.name }
        : { mode: "delete", tag }
    );
  }

  function refreshTag(id: string, tag?: TagPickerOption) {
    if (props.value.some((option) => option.id === id)) {
      props.onChange(
        tag
          ? props.value.map((option) => (option.id === id ? tag : option))
          : props.value.filter((option) => option.id !== id)
      );
    }
    setResults(null);
    setPage(1);
    setReload((attempt) => attempt + 1);
  }

  async function submitEditor() {
    if (saving || props.disabled || !editor || !departmentId) return;
    if (
      editor.mode === "delete"
        ? !editor.tag.canManage || references !== 0 || tagConflict
        : !canSubmitEditor
    )
      return;

    setEditorError("");
    setSaving(true);
    onCreatingChange?.(true);
    try {
      if (editor.mode === "create" && createTag) {
        const { tag } = await createTag({
          name: tagName,
          color: tagColor ?? undefined,
          departmentId,
        });
        if (!props.value.some(({ id }) => id === tag.id)) {
          props.onChange([...props.value, tag]);
        }
        returnToOptions.current = true;
        setPage(1);
        setReload((attempt) => attempt + 1);
      } else if (editor.mode !== "create") {
        const id = editor.tag.id;
        const snapshot = { expectedName: editor.tag.name, expectedColor };
        if (editor.mode === "delete") {
          await manageTags.remove(id, snapshot);
          refreshTag(id);
        } else {
          const { tag } = await manageTags.update(id, {
            ...snapshot,
            name: tagName,
            color: nextColor,
          });
          refreshTag(id, tag);
        }
      }
      setEditor(null);
    } catch (error) {
      if (
        editor.mode !== "create" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "tag_conflict"
      ) {
        const current = "current" in error ? error.current : null;
        const id = editor.tag.id;
        if (
          current &&
          typeof current === "object" &&
          "id" in current &&
          current.id === id &&
          "name" in current &&
          typeof current.name === "string" &&
          "color" in current &&
          typeof current.color === "string" &&
          (current.color === defaultTagColor ||
            hasVisibleTagColor(current.color))
        ) {
          refreshTag(id, {
            ...editor.tag,
            name: current.name,
            color: current.color,
            canManage:
              "canManage" in current
                ? current.canManage === true
                : editor.tag.canManage,
          });
        }
        setTagConflict(true);
        setEditorError("标签已被其他人修改。请关闭弹窗并重新打开后再操作。");
      } else {
        if (
          deletingTag &&
          error instanceof Error &&
          "code" in error &&
          error.code === "tag_in_use"
        ) {
          const current = "current" in error ? error.current : null;
          setReferences(
            current &&
              typeof current === "object" &&
              "references" in current &&
              typeof current.references === "number"
              ? current.references
              : null
          );
        }
        setEditorError(
          error instanceof Error ? error.message : "标签操作失败，请重试。"
        );
      }
    } finally {
      setSaving(false);
      onCreatingChange?.(false);
    }
  }

  const hasMore =
    currentResult && currentResult.page * tagPageSize < currentResult.total;

  function restoreFocus(event: Event) {
    event.preventDefault();
    if (returnToOptions.current) {
      returnToOptions.current = false;
      setOpen(true);
    } else {
      trigger.current?.focus({ preventScroll: true });
    }
  }

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id} preventControlActivation>
        {props.label}
      </FieldLabel>
      <SearchableMultiSelect
        {...props}
        items={matchingTags}
        getOptionColor={(option) => option.color}
        onManageOption={manageTag}
        isOptionManageable={(tag) => tag.canManage === true}
        onManageOptionUnavailable={() => {
          toastManager.add({
            id: `${props.id}-tag-management-unavailable`,
            title: "此标签已不可在当前部门管理。",
            type: "error",
          });
        }}
        emptyMessage={
          searchError ||
          (loading || !currentResult ? "正在加载标签…" : "没有匹配的标签")
        }
        disabled={props.disabled || !departmentId || saving}
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
        open={editor !== null && editor.mode !== "delete"}
        title={editedTag ? "编辑标签" : "新建标签"}
        description={
          editedTag
            ? "保存后，所有引用此标签的记录都会显示更新后的标签。"
            : "创建后会自动选中这个标签。"
        }
        showDescription={Boolean(editedTag)}
        inputId={props.id + (editedTag ? "-edit-name" : "-new-name")}
        inputLabel="标签名称"
        placeholder="输入标签名称"
        maxLength={64}
        value={editor && editor.mode !== "delete" ? editor.name : ""}
        busy={saving}
        disabled={props.disabled}
        submitDisabled={!canSubmitEditor}
        submitLabel={editedTag ? "保存" : "创建"}
        busyLabel={editedTag ? "正在保存…" : "正在创建…"}
        error={editorError}
        color={{
          value: tagColor,
          onChange: setTagColor,
          original: hasVisibleTagColor(expectedColor)
            ? expectedColor.toLowerCase()
            : null,
        }}
        onValueChange={(name) => {
          setEditor((current) =>
            current && current.mode !== "delete"
              ? { ...current, name }
              : current
          );
          if (!tagConflict) setEditorError("");
        }}
        onConfirm={submitEditor}
        onOpenChange={(next) => {
          if (!next) setEditor(null);
        }}
        onCloseAutoFocus={restoreFocus}
      />
      <AlertDialog
        open={deletingTag !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setEditor(null);
        }}
      >
        <AlertDialogContent
          className="w-[calc(100%-2rem)]"
          onCloseAutoFocus={restoreFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签</AlertDialogTitle>
            <AlertDialogDescription
              className="min-w-0 wrap-anywhere"
              aria-live="polite"
            >
              {references === null
                ? editorError
                  ? `无法删除「${deletingTag?.name}」。`
                  : "正在检查标签引用…"
                : references > 0
                  ? `「${deletingTag?.name}」已被 ${references} 条记录引用。请先解除关联再删除。`
                  : `确认删除「${deletingTag?.name}」？此标签将从候选列表移除。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {editorError && <FieldError>{editorError}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                saving || props.disabled || tagConflict || references !== 0
              }
              onClick={(event) => {
                event.preventDefault();
                submitEditor();
              }}
            >
              {saving ? "正在删除…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Field>
  );
}
