import {
  type CountryCode,
  DEFAULT_PHONE_COUNTRY,
  getCountryCallingCode,
  normalizeMobilePhone,
} from "@repo/phone";
import { Plus, Trash2 } from "lucide-react";
import {
  type ComponentProps,
  type FormEvent,
  type Ref,
  useId,
  useRef,
  useState,
} from "react";

import {
  PhoneNumberInput,
  readPhoneDraft,
} from "@/components/shared/phone-number-input";
import {
  keepDialogOpenOnComboboxEscape,
  SearchableSelect,
} from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type {
  ContactFormDraft,
  CustomerContact,
  CustomerContactMethod,
  CustomerContactMethodType,
} from "@/request/customers";

import { contactMethodLabels, contactMethodOptions } from "./method-labels";
import {
  contactMethodDuplicateError,
  contactValueError,
  isPhoneMethod,
  sameContactValue,
} from "./method-value";

type MethodDraft = {
  key: string;
  original?: CustomerContactMethod;
  type: CustomerContactMethodType;
  value: string;
  country: CountryCode;
};

const methodColumns =
  "grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_2rem]";

function methodCountry(method: CustomerContactMethod) {
  return isPhoneMethod(method.type)
    ? (readPhoneDraft(method.value, DEFAULT_PHONE_COUNTRY).number?.country ??
        DEFAULT_PHONE_COUNTRY)
    : DEFAULT_PHONE_COUNTRY;
}

function newMethod(type: CustomerContactMethodType): MethodDraft {
  return {
    key: crypto.randomUUID(),
    type,
    value: "",
    country: DEFAULT_PHONE_COUNTRY,
  };
}

function hasValue(method: MethodDraft) {
  return Boolean(method.value.trim());
}

function methodDisplay(method: MethodDraft) {
  const label = contactMethodLabels[method.type];
  return method.value.trim()
    ? `${label} · ${method.value.trim()}`
    : `${label}（待填写）`;
}

export function ContactManagerDialog({
  contact,
  locked,
  pending,
  error,
  onClose,
  onSave,
  onCloseAutoFocus,
  retryOnly,
  nameInputRef,
}: {
  contact?: CustomerContact;
  locked: boolean;
  pending?: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: ContactFormDraft) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
  retryOnly?: boolean;
  nameInputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(contact?.name ?? "");
  const [methods, setMethods] = useState<MethodDraft[]>(() =>
    contact
      ? contact.methods.map((method) => ({
          key: method.id,
          original: method,
          type: method.type,
          value: method.value,
          country: methodCountry(method),
        }))
      : [newMethod("phone")]
  );
  const [primaryKey, setPrimaryKey] = useState(
    contact?.methods.find((method) => method.isPrimary)?.id ??
      contact?.methods[0]?.id ??
      ""
  );
  const [validation, setValidation] = useState<{
    message: string;
    field?: string;
  }>();
  const nameId = `${id}-name`;
  const primaryId = `${id}-primary`;
  const errorId = `${id}-validation`;
  const fieldsLocked = locked || retryOnly;
  const title = contact ? "编辑联系人" : "新建联系人";
  const valueId = (key: string) => `${id}-method-value-${key}`;
  const primaryOptions = methods
    .filter((method) => hasValue(method) || method.key === primaryKey)
    .map((method) => ({
      key: method.key,
      name: methodDisplay(method),
      disabled: !hasValue(method),
    }));

  function focusMethod(method?: MethodDraft) {
    requestAnimationFrame(() => {
      const input = method
        ? document.getElementById(valueId(method.key))
        : null;
      (input ?? addButton.current)?.focus({ preventScroll: !method });
    });
  }

  function showFieldError(field: string, message: string) {
    setValidation({ field, message });
    requestAnimationFrame(() => {
      document.getElementById(field)?.focus({ preventScroll: true });
      const error = document.getElementById(errorId);
      const fieldGroup = error?.parentElement?.parentElement;
      fieldGroup?.scrollIntoView({ block: "nearest" });
    });
  }

  function renderFieldError(field: string) {
    if (validation?.field !== field) return null;
    return (
      <FieldError id={errorId} className="mt-1">
        {validation.message}
      </FieldError>
    );
  }

  function changeMethod(
    method: MethodDraft,
    change: Partial<Pick<MethodDraft, "type" | "value" | "country">>
  ) {
    const updated = { ...method, ...change };
    setMethods((items) =>
      items.map((item) => (item.key === method.key ? updated : item))
    );
    if (!primaryKey && hasValue(updated)) setPrimaryKey(updated.key);
    setValidation(undefined);
  }

  function addMethod() {
    const type =
      contactMethodOptions.find(
        ({ type }) => !methods.some((method) => method.type === type)
      )?.type ?? "email";
    const method = newMethod(type);
    setMethods((items) => [...items, method]);
    setValidation(undefined);
    focusMethod(method);
  }

  function removeMethod(index: number) {
    const removed = methods[index];
    const remaining = methods.filter((method) => method.key !== removed.key);
    setMethods(remaining);
    if (primaryKey === removed.key) {
      const replacement =
        remaining.slice(index).find(hasValue) ??
        remaining.slice(0, index).find(hasValue);
      setPrimaryKey(replacement?.key ?? "");
    }
    setValidation(undefined);
    focusMethod(remaining[index] ?? remaining.at(-1));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;

    const cleanName = name.trim();
    if (!cleanName) {
      showFieldError(nameId, "请输入联系人姓名。");
      return;
    }
    if (!contact && methods.length === 0) {
      setValidation({ message: "请至少添加一种联系方式。" });
      addButton.current?.focus();
      return;
    }
    const results: ContactFormDraft["methods"] = [];
    for (const method of methods) {
      const { original, type, value, country } = method;
      const phone = isPhoneMethod(type);
      const canonicalPhone = phone
        ? normalizeMobilePhone(value, country)
        : undefined;
      // 同一个号码使用本地或者国际写法时，保留已有值和版本。
      const unchanged =
        original?.type === type &&
        ((value.trim() === original.value.trim() &&
          (!phone || methodCountry(original) === country)) ||
          (canonicalPhone !== undefined &&
            sameContactValue(type, canonicalPhone, original.value)));
      const invalid = unchanged
        ? undefined
        : contactValueError(type, value, country);
      const prepared = {
        id: original?.id,
        type,
        value: unchanged ? original.value : (canonicalPhone ?? value.trim()),
        isPrimary: method.key === primaryKey,
      };
      const message = invalid ?? contactMethodDuplicateError(prepared, results);
      if (message) {
        showFieldError(valueId(method.key), message);
        return;
      }
      results.push(prepared);
    }
    if (results.length && !results.some((method) => method.isPrimary)) {
      showFieldError(primaryId, "请选择主要联系方式。");
      return;
    }
    setValidation(undefined);
    onSave({ name: cleanName, methods: results });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        ref={content}
        className="flex max-h-[min(85dvh,calc(100dvh-2rem))] min-h-0 flex-col gap-4 motion-reduce:animate-none! sm:max-w-2xl sm:p-6"
        overlayClassName="motion-reduce:animate-none!"
        showCloseButton={!locked}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) =>
          keepDialogOpenOnComboboxEscape(event, content.current)
        }
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            填写联系人姓名和联系方式，选择主要联系方式后一起保存。
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={submit} noValidate>
          <div className="min-h-0 space-y-4 overflow-y-auto px-1 py-1">
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2">
              <Field className="min-w-0 gap-1.5">
                <FieldLabel htmlFor={nameId}>联系人姓名</FieldLabel>
                <div>
                  <Input
                    id={nameId}
                    ref={nameInputRef}
                    className="shadow-none"
                    value={name}
                    maxLength={128}
                    disabled={fieldsLocked}
                    aria-invalid={validation?.field === nameId || undefined}
                    aria-describedby={
                      validation?.field === nameId ? errorId : undefined
                    }
                    onChange={(event) => {
                      setName(event.target.value);
                      setValidation(undefined);
                    }}
                    required
                  />
                  {renderFieldError(nameId)}
                </div>
              </Field>
              <Field className="min-w-0 gap-1.5">
                <FieldLabel htmlFor={primaryId} preventControlActivation>
                  主要联系方式
                </FieldLabel>
                <div>
                  <SearchableSelect
                    id={primaryId}
                    items={primaryOptions}
                    value={
                      primaryOptions.find(({ key }) => key === primaryKey) ??
                      null
                    }
                    placeholder="暂无可选联系方式"
                    searchPlaceholder="搜索联系方式"
                    emptyMessage="没有匹配的联系方式"
                    disabled={
                      fieldsLocked ||
                      !primaryOptions.some(({ disabled }) => !disabled)
                    }
                    container={content}
                    aria-invalid={validation?.field === primaryId || undefined}
                    aria-describedby={
                      validation?.field === primaryId ? errorId : undefined
                    }
                    getOptionKey={({ key }) => key}
                    isOptionDisabled={({ disabled }) => disabled}
                    renderOption={({ name }) => (
                      <span className="min-w-0 wrap-anywhere">{name}</span>
                    )}
                    onValueChange={({ key }) => {
                      setPrimaryKey(key);
                      setValidation(undefined);
                    }}
                  />
                  {renderFieldError(primaryId)}
                </div>
              </Field>
            </div>
            <fieldset className="min-w-0 space-y-2">
              <legend className="mb-2 font-medium">联系方式</legend>
              {methods.length > 0 && (
                <div
                  className={`${methodColumns} hidden text-muted-foreground text-xs sm:grid`}
                  aria-hidden="true"
                >
                  <span>类型</span>
                  <span>联系内容</span>
                </div>
              )}
              {methods.map((method, index) => {
                const typeId = `${id}-method-type-${method.key}`;
                const methodValueId = valueId(method.key);
                const phone = isPhoneMethod(method.type);
                const phoneDraft = phone
                  ? readPhoneDraft(method.value, method.country)
                  : undefined;
                const phoneCountry =
                  phoneDraft?.number?.country ?? method.country;
                const inputProps = {
                  id: methodValueId,
                  value: method.value,
                  maxLength: 320,
                  disabled: fieldsLocked,
                  "aria-label": `第 ${index + 1} 项联系内容`,
                  "aria-invalid":
                    validation?.field === methodValueId || undefined,
                  "aria-describedby":
                    validation?.field === methodValueId ? errorId : undefined,
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    const next = event.target.value;
                    const draft = phone
                      ? readPhoneDraft(next, method.country)
                      : undefined;
                    const normalized = draft?.international
                      ? normalizeMobilePhone(next, method.country)
                      : undefined;
                    changeMethod(method, {
                      country:
                        (normalized && draft?.number?.country) ||
                        method.country,
                      value:
                        normalized && !next.trimStart().startsWith("+")
                          ? normalized
                          : next,
                    });
                  },
                };
                return (
                  <div key={method.key} className={methodColumns}>
                    <SearchableSelect
                      id={typeId}
                      aria-label={`第 ${index + 1} 项联系方式类型`}
                      items={contactMethodOptions}
                      value={
                        contactMethodOptions.find(
                          ({ type }) => type === method.type
                        ) ?? null
                      }
                      placeholder="选择联系方式"
                      searchPlaceholder="搜索联系方式类型"
                      emptyMessage="暂无可选联系方式类型"
                      showSearch={false}
                      disabled={fieldsLocked}
                      getOptionKey={({ type }) => type}
                      onValueChange={({ type }) =>
                        changeMethod(method, { type })
                      }
                    />
                    <div className="col-span-2 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      {phone ? (
                        <PhoneNumberInput
                          {...inputProps}
                          country={phoneCountry}
                          callingCode={phoneDraft?.callingCode}
                          portalContainer={content}
                          onCountryChange={(country) => {
                            if (
                              country !== phoneCountry ||
                              (phoneDraft?.callingCode &&
                                phoneDraft.callingCode !==
                                  getCountryCallingCode(country))
                            ) {
                              changeMethod(method, {
                                country,
                                value:
                                  phoneDraft?.nationalValue ?? method.value,
                              });
                            }
                          }}
                        />
                      ) : (
                        <Input
                          {...inputProps}
                          className="shadow-none"
                          type={method.type === "email" ? "email" : "text"}
                        />
                      )}
                      {renderFieldError(methodValueId)}
                    </div>
                    <Button
                      className="col-start-2 row-start-1 text-muted-foreground sm:col-start-3"
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`移除第 ${index + 1} 项联系方式`}
                      disabled={fieldsLocked}
                      onClick={() => removeMethod(index)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
              {methods.length === 0 && (
                <p className="text-muted-foreground">暂无联系方式</p>
              )}
              <Button
                ref={addButton}
                type="button"
                variant="ghost"
                className="w-full"
                disabled={fieldsLocked}
                onClick={addMethod}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                添加联系方式
              </Button>
            </fieldset>
            <FieldError>
              {validation?.field ? null : validation?.message}
            </FieldError>
          </div>
          {!validation && (
            <FieldError className="mt-2 shrink-0 px-1">{error}</FieldError>
          )}
          <div className="mt-2 flex flex-none justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={locked}>
              {pending ? "正在保存…" : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
