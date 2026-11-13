import { Plus } from "lucide-react";
import { type ComponentPropsWithRef, useEffect, useRef, useState } from "react";

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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
    | "placeholder"
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

type TagPage = {
  keyword: string;
  items: CustomerFormOption[];
  page: number;
  total: number;
};

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
  const [enteringName, setEnteringName] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<TagPage | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const keyword = search.trim();
  const visible = results?.keyword === keyword ? results : null;
  const matchingTags = visible?.items ?? [];
  const exactMatch = [...matchingTags, ...props.value].some(
    (option) => option.name.toLowerCase() === keyword.toLowerCase()
  );
  const canCreate =
    allowCreate &&
    keyword &&
    visible &&
    !loading &&
    !exactMatch &&
    !searchError;
  const items =
    allowCreate && !keyword && !enteringName
      ? [{ id: createTagOptionId, name: "" }, ...matchingTags]
      : canCreate
        ? [...matchingTags, { id: createTagOptionId, name: keyword }]
        : matchingTags;

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
    setCreateError("");
  }

  async function createTag(name: string) {
    setCreateError("");
    setCreating(true);
    onCreatingChange(true);
    try {
      const { tag } = await createCustomerTag({ name });
      props.onChange([...props.value, { id: tag.id, name: tag.name }]);
      setEnteringName(false);
      setSearch("");
      setPage(1);
      setReload((attempt) => attempt + 1);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "标签新建失败，请重试。"
      );
      setReload((attempt) => attempt + 1);
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
          const newTag = selected.find(
            (option) => option.id === createTagOptionId
          );
          if (!newTag) {
            props.onChange(selected);
            return;
          }
          details.cancel();
          if (newTag.name) {
            void createTag(newTag.name);
          } else {
            setEnteringName(true);
            input.current?.focus();
          }
        }}
        itemToStringLabel={optionLabel}
        isItemEqualToValue={isSameOption}
        onOpenChange={(next, details) => {
          if (!next && details.reason === "item-press") {
            details.cancel();
            return;
          }
          setOpen(next);
          if (!next) {
            setEnteringName(false);
            changeSearch("");
          }
        }}
      >
        <SelectionControl
          {...props}
          anchor={anchor}
          inputProps={{
            ref: input,
            ...(enteringName && { placeholder: "输入标签名称" }),
            onCompositionStart: () => {
              composing.current = true;
            },
            onCompositionEnd: () => {
              composing.current = false;
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !open) return;
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
              (loading || !visible ? "正在加载标签…" : "没有匹配的标签")}
          </ComboboxEmpty>
          <ComboboxList>
            {(option: CustomerFormOption) => (
              <ComboboxItem key={option.id} value={option} disabled={creating}>
                {option.id === createTagOptionId ? (
                  <>
                    <Plus aria-hidden="true" />
                    {creating
                      ? "正在新建…"
                      : option.name
                        ? `新建标签「${option.name}」`
                        : "新建标签"}
                  </>
                ) : (
                  option.name
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
          {createError ? (
            <FieldError className="border-t px-2 py-2">
              {createError}
            </FieldError>
          ) : null}
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
          ) : visible && visible.page * tagPageSize < visible.total ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading || creating}
                onClick={() => setPage(visible.page + 1)}
              >
                {loading ? "正在加载…" : "加载更多标签"}
              </Button>
            </div>
          ) : null}
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
