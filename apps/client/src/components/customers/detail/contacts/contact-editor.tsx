import {
  type CountryCode,
  DEFAULT_PHONE_COUNTRY,
  getCountryCallingCode,
  normalizeMobilePhone,
} from "@repo/phone";
import {
  type ChangeEvent,
  type FormEvent,
  type Ref,
  useId,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import { contactMethodLabels } from "./method-labels";
import {
  contactValueError,
  isPhoneMethod,
  sameContactValue,
} from "./method-value";
import type { ContactChange, ContactEditSnapshot } from "./mutations";
import { PhoneNumberInput, readPhoneDraft } from "./phone-number-input";

export type ContactEditorMode =
  | { kind: "add"; contacts: CustomerContact[]; selectedContactId?: string }
  | ContactEditSnapshot;

const newContactId = "new-contact";

/**
 * 为同名联系人附上序号和主要联系方式，便于在下拉选项中区分。
 * @param contact 要显示的联系人。
 * @param contacts 下拉选项对应的完整联系人列表。
 * @returns 联系人名称，存在同名项时返回带区分信息的标签。
 */
function contactOptionLabel(
  contact: CustomerContact,
  contacts: CustomerContact[]
) {
  const sameName = contacts.filter((item) => item.name === contact.name);
  if (sameName.length === 1) return contact.name;

  const primaryValue = contact.methods.find(
    (method) => method.isPrimary
  )?.value;
  const position = sameName.findIndex((item) => item.id === contact.id) + 1;
  return `${contact.name}（同名 ${position}） · ${primaryValue ?? "暂无联系方式"}`;
}

export function CustomerContactEditor({
  mode,
  restored,
  inputRef,
  pending,
  locked,
  error,
  onClose,
  onSubmit,
}: {
  mode: ContactEditorMode;
  restored: boolean;
  inputRef: Ref<HTMLInputElement>;
  pending: boolean;
  locked: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (change: ContactChange) => void;
}) {
  const id = useId();
  // 冲突返回的远端资料用于弹窗和版本校验，表单始终从打开时的快照取值。
  const initialMethod = mode.kind === "edit" ? mode.method : undefined;
  const [selectedContactId, setSelectedContactId] = useState(
    mode.kind === "add"
      ? (mode.selectedContactId ?? newContactId)
      : mode.contact.id
  );
  const [name, setName] = useState(
    mode.kind === "rename" ? mode.contact.name : ""
  );
  const [typeOverride, setTypeOverride] = useState<
    CustomerContactMethodType | ""
  >();
  const [valueOverride, setValueOverride] = useState<string>();
  const [countryOverride, setCountryOverride] = useState<CountryCode>();
  const [primaryOverride, setPrimaryOverride] = useState<boolean>();
  const [validation, setValidation] = useState("");

  const selected =
    mode.kind === "add"
      ? mode.contacts.find((contact) => contact.id === selectedContactId)
      : mode.contact;
  const type = typeOverride ?? initialMethod?.type ?? "";
  const value = valueOverride ?? initialMethod?.value ?? "";
  const phone = isPhoneMethod(type);
  const savedCountry =
    initialMethod && isPhoneMethod(initialMethod.type)
      ? (readPhoneDraft(initialMethod.value, DEFAULT_PHONE_COUNTRY).number
          ?.country ?? DEFAULT_PHONE_COUNTRY)
      : DEFAULT_PHONE_COUNTRY;
  const phoneInputCountry =
    (valueOverride !== undefined && countryOverride) || savedCountry;
  const phoneDraft = phone
    ? readPhoneDraft(value, phoneInputCountry)
    : undefined;
  const phoneCountry = phoneDraft?.number?.country ?? phoneInputCountry;
  const canonicalPhone = phone
    ? normalizeMobilePhone(value, phoneInputCountry)
    : undefined;
  // 同一号码的本地写法和国际写法不会产生额外的编辑或版本变化。
  const valueMatchesCurrent =
    phone && type === initialMethod?.type && canonicalPhone
      ? sameContactValue(type, canonicalPhone, initialMethod.value)
      : value.trim() === initialMethod?.value &&
        (!phone || phoneCountry === savedCountry);
  const currentPrimary = initialMethod?.isPrimary;
  const isPrimary = primaryOverride ?? currentPrimary ?? false;
  const showName = mode.kind === "rename" || !selected;
  const takenTypes =
    selected?.methods
      .filter((item) => item.id !== initialMethod?.id)
      .map((item) => item.type) ?? [];
  const typeTaken = type !== "" && takenTypes.includes(type);
  const canChangePrimary =
    mode.kind !== "edit" || (selected?.methods.length ?? 0) > 1;
  const typeChanged =
    typeOverride !== undefined && type !== initialMethod?.type;
  const valueChanged = valueOverride !== undefined && !valueMatchesCurrent;
  const primaryChanged =
    canChangePrimary &&
    primaryOverride !== undefined &&
    isPrimary !== currentPrimary;

  const title =
    mode.kind === "rename"
      ? "编辑联系人"
      : mode.kind === "edit"
        ? "编辑联系方式"
        : "添加联系方式";
  const changed =
    mode.kind === "rename"
      ? name.trim() !== mode.contact.name
      : !initialMethod || typeChanged || valueChanged || primaryChanged;

  /**
   * 校验表单并通过回调提交对应操作，编辑时只提交改动字段。
   * @param event 联系方式表单的提交事件。
   * @returns 无返回值。校验失败时在表单内显示提示。
   */
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !changed) return;
    setValidation("");
    const cleanedName = name.trim();
    if (showName && !cleanedName) {
      setValidation("请输入联系人姓名。");
      return;
    }
    if (mode.kind === "rename") {
      onSubmit({ kind: "rename", contact: mode.contact, name: cleanedName });
      return;
    }

    const cleanedValue = value.trim();
    if (!type || !cleanedValue || typeTaken) {
      setValidation("请选择可用的联系方式并填写联系信息。");
      return;
    }
    if (mode.kind !== "edit" || typeChanged || valueChanged) {
      const valueError = contactValueError(
        type,
        cleanedValue,
        phoneInputCountry
      );
      if (valueError) {
        setValidation(valueError);
        return;
      }
    }
    if (mode.kind === "edit") {
      const fields: Partial<CustomerContactMethodInput> = {};
      // 只提交相对初始表单改动的字段；版本由提交方另行选取。
      if (typeChanged) fields.type = type;
      if (valueChanged) fields.value = canonicalPhone ?? cleanedValue;
      if (primaryChanged) fields.isPrimary = isPrimary;
      onSubmit({
        kind: "edit",
        contact: mode.contact,
        methodId: mode.method.id,
        fields,
      });
      return;
    }

    const newMethod = {
      type,
      value: canonicalPhone ?? cleanedValue,
      isPrimary,
    };
    onSubmit(
      selected
        ? { kind: "add", contact: selected, method: newMethod }
        : { kind: "create", name: cleanedName, method: newMethod }
    );
  }

  const valueInputProps = {
    id: `${id}-value`,
    ref: inputRef,
    value,
    maxLength: 320,
    disabled: locked,
    required: true,
    "aria-invalid": Boolean(
      validation &&
        type &&
        validation === contactValueError(type, value, phoneInputCountry)
    ),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (phone) {
        const draft = readPhoneDraft(next, phoneInputCountry);
        const normalized = draft.international
          ? normalizeMobilePhone(next, phoneInputCountry)
          : undefined;
        // 将可保存的国际拨号格式转为 "+"，换到目的地后仍按同一个号码解析。
        setCountryOverride(
          (normalized && draft.number?.country) || phoneInputCountry
        );
        setValueOverride(
          normalized && !next.trimStart().startsWith("+") ? normalized : next
        );
      } else {
        setValueOverride(next === initialMethod?.value ? undefined : next);
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
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            维护当前客户的联系人及联系信息。
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={submit}
          noValidate
        >
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {mode.kind === "add" && mode.contacts.length > 0 && (
              <Field>
                <FieldLabel htmlFor={`${id}-person`}>联系人</FieldLabel>
                <Select
                  disabled={locked}
                  value={selectedContactId}
                  onValueChange={(next) => {
                    setSelectedContactId(next);
                    setValidation("");
                    if (
                      mode.contacts
                        .find((contact) => contact.id === next)
                        ?.methods.some((item) => item.type === type)
                    )
                      setTypeOverride("");
                    if (typeTaken) setPrimaryOverride(undefined);
                  }}
                >
                  <SelectTrigger className="w-full" id={`${id}-person`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={newContactId}>新建联系人</SelectItem>
                    {mode.contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contactOptionLabel(contact, mode.contacts)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {showName && (
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>联系人姓名</FieldLabel>
                <Input
                  id={`${id}-name`}
                  ref={mode.kind === "rename" ? inputRef : undefined}
                  value={name}
                  maxLength={128}
                  disabled={locked}
                  required
                  onChange={(event) => {
                    setName(event.target.value);
                    setValidation("");
                  }}
                />
              </Field>
            )}
            {mode.kind === "edit" && (
              <div className="space-y-1.5 text-sm">
                <p className="text-muted-foreground">联系人</p>
                <p className="font-medium">{mode.contact.name}</p>
              </div>
            )}
            {mode.kind !== "rename" && (
              <>
                <Field>
                  <FieldLabel htmlFor={`${id}-type`}>联系方式</FieldLabel>
                  <Select
                    disabled={locked}
                    value={typeTaken ? "" : type}
                    onValueChange={(next) => {
                      // 冲突后改选类型时，重新确认是否要替换最新的主要项。
                      if (mode.kind === "add" && typeTaken) {
                        setPrimaryOverride(undefined);
                      }
                      setTypeOverride(
                        next === initialMethod?.type
                          ? undefined
                          : (next as CustomerContactMethodType)
                      );
                      setValidation("");
                    }}
                  >
                    <SelectTrigger className="w-full" id={`${id}-type`}>
                      <SelectValue placeholder="选择联系方式" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(contactMethodLabels).map(
                        ([methodType, label]) => (
                          <SelectItem
                            key={methodType}
                            value={methodType}
                            disabled={takenTypes.some(
                              (taken) => taken === methodType
                            )}
                          >
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-value`}>联系信息</FieldLabel>
                  {phone ? (
                    <PhoneNumberInput
                      {...valueInputProps}
                      country={phoneCountry}
                      callingCode={phoneDraft?.callingCode}
                      onCountryChange={(next) => {
                        if (
                          next === phoneCountry &&
                          (!phoneDraft?.callingCode ||
                            phoneDraft.callingCode ===
                              getCountryCallingCode(next))
                        )
                          return;
                        setCountryOverride(next);
                        setValueOverride(phoneDraft?.nationalValue ?? value);
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
                {selected &&
                  (selected.methods.length > 1 ||
                    (mode.kind === "add" && selected.methods.length > 0)) && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={isPrimary && !typeTaken}
                        disabled={locked || typeTaken}
                        onCheckedChange={(checked) => {
                          const next = checked === true;
                          setPrimaryOverride(
                            next === (initialMethod?.isPrimary ?? false)
                              ? undefined
                              : next
                          );
                        }}
                      />
                      设为主要联系方式
                    </label>
                  )}
              </>
            )}
            {restored && (
              <p className="text-muted-foreground text-sm" role="status">
                旧值已写回，草稿尚未保存。
              </p>
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
            <Button type="submit" disabled={locked || !changed || typeTaken}>
              {pending ? "正在保存…" : "保存"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
