import {
  type CountryCode,
  DEFAULT_PHONE_COUNTRY,
  getCountryCallingCode,
  normalizeMobilePhone,
} from "@repo/server";
import { type FormEvent, type Ref, useId, useRef, useState } from "react";

import {
  PhoneNumberInput,
  readPhoneDraft,
} from "@/components/shared/phone-number-input";
import {
  keepDialogOpenOnComboboxEscape,
  SearchableSelect,
} from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  CustomerContact,
  CustomerContactMethodInput,
  CustomerContactMethodType,
} from "@/request/customers";

import { contactMethodOptions } from "./method-labels";
import {
  contactMethodDuplicateError,
  contactValueError,
  isPhoneMethod,
} from "./method-value";

/** 单独添加一条联系方式时，在联系人分组原有的加号入口打开。 */
export function CustomerContactEditor({
  contact,
  inputRef,
  pending,
  locked,
  error,
  onClose,
  onSubmit,
}: {
  contact: CustomerContact;
  inputRef: Ref<HTMLInputElement>;
  pending: boolean;
  locked: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (method: CustomerContactMethodInput) => void;
}) {
  const id = useId();
  const primaryId = `${id}-primary`;
  const contentRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<CustomerContactMethodType | "">("");
  const [value, setValue] = useState("");
  const [country, setCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [isPrimary, setIsPrimary] = useState(false);
  const [validation, setValidation] = useState("");

  const usedTypes = contact.methods
    .filter((method) => method.type !== "email")
    .map((method) => method.type);
  const typeTaken = type !== "" && usedTypes.includes(type);
  const phone = isPhoneMethod(type);
  const phoneDraft = phone ? readPhoneDraft(value, country) : undefined;
  const phoneCountry = phoneDraft?.number?.country ?? country;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    if (!type || !value.trim()) {
      setValidation("请选择联系方式类型并填写联系信息。");
      return;
    }
    const method = {
      type,
      value: phone
        ? (normalizeMobilePhone(value, country) ?? value.trim())
        : value.trim(),
      isPrimary,
    };
    const message =
      contactValueError(type, value, country) ??
      contactMethodDuplicateError(method, contact.methods);
    if (message) {
      setValidation(message);
      return;
    }
    setValidation("");
    onSubmit(method);
  }

  const valueInputProps = {
    id: `${id}-value`,
    ref: inputRef,
    value,
    maxLength: 320,
    disabled: locked,
    required: true,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (phone) {
        const draft = readPhoneDraft(next, country);
        const normalized = draft.international
          ? normalizeMobilePhone(next, country)
          : undefined;
        if (normalized && draft.number?.country)
          setCountry(draft.number.country);
        // 换成国际区号后，粘贴的国际拨号格式仍按同一号码读取。
        setValue(
          normalized && !next.trimStart().startsWith("+") ? normalized : next
        );
      } else {
        setValue(next);
      }
      setValidation("");
    },
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <SheetContent
        className="w-full gap-0 sm:max-w-md"
        ref={contentRef}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) =>
          keepDialogOpenOnComboboxEscape(event, contentRef.current)
        }
      >
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-semibold">
            添加联系方式
          </SheetTitle>
          <SheetDescription className="sr-only">
            为当前联系人添加一条联系方式。
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={submit}
          noValidate
        >
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-1.5 text-sm">
              <p className="text-muted-foreground">联系人</p>
              <p className="font-medium">{contact.name}</p>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-type`} preventControlActivation>
                联系方式
              </FieldLabel>
              <SearchableSelect
                id={`${id}-type`}
                items={contactMethodOptions}
                value={
                  typeTaken
                    ? null
                    : (contactMethodOptions.find(
                        (item) => item.type === type
                      ) ?? null)
                }
                placeholder="选择联系方式"
                searchPlaceholder="搜索联系方式类型"
                emptyMessage="暂无可选联系方式类型"
                showSearch={false}
                disabled={locked}
                getOptionKey={({ type }) => type}
                isOptionDisabled={({ type }) => usedTypes.includes(type)}
                onValueChange={({ type }) => {
                  if (typeTaken) setIsPrimary(false);
                  setType(type);
                  setValidation("");
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-value`}>联系信息</FieldLabel>
              {phone ? (
                <PhoneNumberInput
                  {...valueInputProps}
                  country={phoneCountry}
                  callingCode={phoneDraft?.callingCode}
                  portalContainer={contentRef}
                  onCountryChange={(next) => {
                    if (
                      next === phoneCountry &&
                      (!phoneDraft?.callingCode ||
                        phoneDraft.callingCode === getCountryCallingCode(next))
                    )
                      return;
                    setCountry(next);
                    setValue(phoneDraft?.nationalValue ?? value);
                    setValidation("");
                  }}
                />
              ) : (
                <Input
                  {...valueInputProps}
                  type={type === "email" ? "email" : "text"}
                />
              )}
            </Field>
            {contact.methods.length > 0 && (
              <label
                className="flex cursor-pointer items-center gap-2 text-sm"
                htmlFor={primaryId}
              >
                <Checkbox
                  id={primaryId}
                  checked={isPrimary && !typeTaken}
                  disabled={locked || typeTaken}
                  onCheckedChange={(checked) => setIsPrimary(checked === true)}
                />
                设为主要联系方式
              </label>
            )}
            <FieldError>{validation || error}</FieldError>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={locked || typeTaken}>
              {pending ? "正在保存…" : "保存"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
