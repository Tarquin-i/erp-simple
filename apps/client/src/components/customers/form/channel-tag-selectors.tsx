import { Plus } from "lucide-react";
import {
  type ComponentPropsWithRef,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createCustomerTag, listCustomerTags } from "@/request/customers";

export type CustomerFormOption = { id: string; name: string };

type PickerProps = {
  id: string;
  label: string;
  value: CustomerFormOption[];
  onChange: (value: CustomerFormOption[]) => void;
  disabled: boolean;
};

function optionLabel(option: CustomerFormOption) {
  return option.name;
}

function isSameOption(item: CustomerFormOption, selected: CustomerFormOption) {
  return item.id === selected.id;
}

function SelectionControl({
  id,
  label,
  value,
  anchor,
  inputProps,
}: Pick<PickerProps, "id" | "label" | "value"> & {
  anchor: ReturnType<typeof useComboboxAnchor>;
  inputProps?: Pick<
    ComponentPropsWithRef<typeof ComboboxChipsInput>,
    | "ref"
    | "aria-describedby"
    | "onCompositionStart"
    | "onCompositionEnd"
    | "onKeyDown"
  >;
}) {
  return (
    <ComboboxChips ref={anchor} className="min-h-10 gap-y-1 pr-2 shadow-xs">
      <ComboboxValue>
        {value.map((option) => (
          <ComboboxChip
            key={option.id}
            className="max-w-full rounded-lg bg-primary text-primary-foreground [&_[data-slot=combobox-chip-remove]]:text-inherit [&_[data-slot=combobox-chip-remove]]:opacity-80 [&_[data-slot=combobox-chip-remove]:hover]:bg-primary-foreground/15 [&_[data-slot=combobox-chip-remove]:hover]:opacity-100"
          >
            <span className="truncate">{option.name}</span>
          </ComboboxChip>
        ))}
      </ComboboxValue>
      <ComboboxChipsInput
        id={id}
        maxLength={64}
        placeholder={value.length ? "" : `选择${label}`}
        className="min-w-0 px-1 placeholder:text-muted-foreground"
        {...inputProps}
      />
      <ComboboxTrigger
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`打开${label}选项`}
      />
    </ComboboxChips>
  );
}

export function CustomerChannelPicker({
  items,
  ...props
}: PickerProps & { items: CustomerFormOption[] }) {
  const anchor = useComboboxAnchor();
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Combobox
        multiple
        items={items}
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        itemToStringLabel={optionLabel}
        isItemEqualToValue={isSameOption}
        onOpenChange={(open, details) => {
          if (!open && details.reason === "item-press") details.cancel();
        }}
      >
        <SelectionControl {...props} anchor={anchor} />
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>没有匹配的渠道</ComboboxEmpty>
          <ComboboxList>
            {(option: CustomerFormOption) => (
              <ComboboxItem key={option.id} value={option}>
                {option.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

const tagPageSize = 25;
const createTagOptionId = "new-tag";
// 与客户保存接口的标签数量上限一致。
const maxCustomerTags = 100;

type TagPage = {
  keyword: string;
  items: CustomerFormOption[];
  page: number;
  total: number;
};

/**
 * 渲染可搜索、可分页的标签多选框，并按配置提供新建弹窗。
 * @param props `id` 和 `label` 用于关联标签字段。`value` 是已选标签，`onChange` 接收更新后的选项。
 * `allowCreate` 控制新建入口，`disabled` 控制选择操作。
 * `onCreatingChange` 通知父表单创建开始和结束，供父表单在创建期间暂停保存。
 * @returns 标签选择器和新建弹窗。创建成功后自动选中新标签，失败时保留输入并显示错误。
 */
export function CustomerTagPicker({
  allowCreate,
  onCreatingChange,
  ...props
}: PickerProps & {
  allowCreate: boolean;
  onCreatingChange: (creating: boolean) => void;
}) {
  const anchor = useComboboxAnchor();
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
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
  const tagNameId = `${props.id}-new-name`;
  const tagLimitId = `${props.id}-limit`;
  const atTagLimit = props.value.length >= maxCustomerTags;
  const showCreate = allowCreate && !atTagLimit;
  const keyword = search.trim();
  const currentResult = results?.keyword === keyword ? results : null;
  const matchingTags = currentResult?.items ?? [];
  const exactMatch = [...matchingTags, ...props.value].some(
    (option) => option.name.toLowerCase() === keyword.toLowerCase()
  );
  const canCreate =
    showCreate &&
    keyword &&
    currentResult &&
    !loading &&
    !exactMatch &&
    !searchError;
  // 「新建标签」是下拉操作项，选中时打开弹窗，不写入已选标签。
  const items =
    showCreate && !keyword
      ? [{ id: createTagOptionId, name: "" }, ...matchingTags]
      : canCreate
        ? [...matchingTags, { id: createTagOptionId, name: keyword }]
        : matchingTags;

  // 仅在下拉打开时查询。搜索首屏防抖，条件变化时取消上一笔请求。
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setLoading(true);
    setSearchError("");
    const timer = window.setTimeout(
      () => {
        listCustomerTags(
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
  }, [keyword, open, page, reload]);

  function changeSearch(value: string) {
    if (creating) return;
    if (value.trim() !== keyword) setPage(1);
    setSearch(value);
  }

  /**
   * 提交标签弹窗，创建成功后自动选中新标签并关闭弹窗。
   * @param event 标签弹窗表单的提交事件。
   * @returns 处理结束后完成，无业务数据。创建失败时在弹窗内显示错误并保留输入。
   */
  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React 会将 Portal 内的提交事件冒泡给客户表单，阻止它一并保存客户。
    event.stopPropagation();
    const name = tagName?.trim();
    if (!name || creating || atTagLimit) return;

    setCreateError("");
    setCreating(true);
    onCreatingChange(true);
    try {
      const { tag } = await createCustomerTag({ name });
      props.onChange([...props.value, { id: tag.id, name: tag.name }]);
      setReload((attempt) => attempt + 1);
      setTagName(null);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "标签新建失败，请重试。"
      );
    } finally {
      setCreating(false);
      onCreatingChange(false);
    }
  }

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Combobox
        multiple
        items={items}
        filter={null}
        inputValue={search}
        value={props.value}
        disabled={props.disabled}
        open={open}
        onInputValueChange={(value, details) => {
          if (details.isItemPress) details.cancel();
          else changeSearch(value);
        }}
        onValueChange={(selected, details) => {
          if (creating) {
            details.cancel();
            return;
          }
          const createTagOption = selected.find(
            (option) => option.id === createTagOptionId
          );
          if (!createTagOption) {
            if (
              selected.length > maxCustomerTags &&
              selected.length >= props.value.length
            ) {
              details.cancel();
              return;
            }
            props.onChange(selected);
            return;
          }
          details.cancel();
          if (atTagLimit) return;
          setOpen(false);
          changeSearch("");
          setCreateError("");
          setTagName(createTagOption.name);
        }}
        itemToStringLabel={optionLabel}
        isItemEqualToValue={isSameOption}
        onOpenChange={(next, details) => {
          if (!next && details.reason === "item-press") {
            details.cancel();
            return;
          }
          setOpen(next);
          if (!next) changeSearch("");
        }}
      >
        <SelectionControl
          {...props}
          anchor={anchor}
          inputProps={{
            ref: input,
            "aria-describedby": atTagLimit ? tagLimitId : undefined,
            onCompositionStart: () => {
              composing.current = true;
            },
            onCompositionEnd: () => {
              composing.current = false;
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !open) return;
              // 输入法选字时的回车应留给输入法，避免选中标签或提交表单。
              if (
                composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              ) {
                event.preventBaseUIHandler();
                return;
              }
              if (!event.currentTarget.getAttribute("aria-activedescendant")) {
                event.preventDefault();
              }
            },
          }}
        />
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {searchError ||
              (loading || !currentResult ? "正在加载标签…" : "没有匹配的标签")}
          </ComboboxEmpty>
          <ComboboxList>
            {(option: CustomerFormOption) => (
              <ComboboxItem
                key={option.id}
                value={option}
                disabled={
                  creating ||
                  (atTagLimit &&
                    !props.value.some(({ id }) => id === option.id))
                }
              >
                {option.id === createTagOptionId ? (
                  <>
                    <Plus aria-hidden="true" />
                    {option.name ? `新建标签「${option.name}」` : "新建标签"}
                  </>
                ) : (
                  option.name
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
          {searchError ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setReload((attempt) => attempt + 1)}
              >
                重试加载标签
              </Button>
            </div>
          ) : currentResult &&
            currentResult.page * tagPageSize < currentResult.total ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading || creating}
                onClick={() => setPage(currentResult.page + 1)}
              >
                {loading ? "正在加载…" : "加载更多标签"}
              </Button>
            </div>
          ) : null}
        </ComboboxContent>
      </Combobox>
      {atTagLimit && (
        <FieldDescription id={tagLimitId} role="status">
          每个客户最多可选 {maxCustomerTags} 个标签。移除已有标签后可继续选择。
        </FieldDescription>
      )}
      <Dialog
        open={tagName !== null}
        onOpenChange={(next) => {
          if (!next && !creating) setTagName(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>新建标签</DialogTitle>
            <DialogDescription className="sr-only">
              创建后会自动选中这个标签。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitTag}>
            <Field data-invalid={Boolean(createError)}>
              <FieldLabel htmlFor={tagNameId}>标签名称</FieldLabel>
              <Input
                id={tagNameId}
                placeholder="输入标签名称"
                maxLength={64}
                value={tagName ?? ""}
                readOnly={creating}
                aria-required="true"
                aria-invalid={Boolean(createError)}
                aria-describedby={
                  createError ? `${tagNameId}-error` : undefined
                }
                onChange={(event) => {
                  setTagName(event.target.value);
                  setCreateError("");
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229)
                  ) {
                    event.preventDefault();
                  }
                }}
              />
              {createError && (
                <FieldError id={`${tagNameId}-error`}>{createError}</FieldError>
              )}
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setTagName(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={creating || atTagLimit || !tagName?.trim()}
              >
                {creating ? "正在创建…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
