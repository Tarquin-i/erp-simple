import {
  type CountryCode,
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import { CommunicationCustomerField } from "@/components/communication/form/customer-field";
import {
  PhoneNumberInput,
  readPhoneDraft,
} from "@/components/customers/detail/contacts/phone-number-input";
import { VersionConflictDialog } from "@/components/customers/version-conflict-dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AddressApiError,
  type AddressCustomer,
  type AddressDetail,
  type AddressWriteInput,
  createAddress,
  isAddressSnapshot,
  updateAddress,
} from "@/request/addresses";
import {
  addressCountries,
  formatAddressPostalCode,
  getAddressRegions,
} from "./geography";

const fieldLabels = {
  recipientName: "收货人",
  phone: "联系电话",
  countryCode: "国家或地区",
  province: "省/州",
  city: "城市",
  district: "区县",
  addressLine1: "详细地址",
  addressLine2: "补充地址",
  postalCode: "邮编",
  remark: "备注",
  isDefault: "设为默认地址",
} satisfies Record<keyof AddressWriteInput, string>;

type AddressField = keyof AddressWriteInput;
type TextField = Exclude<AddressField, "isDefault">;
type LocationOption = (typeof addressCountries)[number];
type CreateSubmission = {
  kind: "create";
  customerId: string;
  input: AddressWriteInput;
  replaceExistingDefault: boolean;
};
type EditSubmission = {
  kind: "edit";
  base: AddressDetail;
  patch: Partial<AddressWriteInput>;
};
type Prompt =
  | { kind: "replace-default"; submission: CreateSubmission }
  | { kind: "version"; submission: EditSubmission };

const addressFields = Object.keys(fieldLabels) as AddressField[];

/** 支持按中文名称、英文名称或地区代码查找地址选项。 */
function matchesLocation(option: LocationOption, query: string) {
  return `${option.name} ${option.keywords}`
    .toLowerCase()
    .includes(query.toLowerCase());
}

/** 从当前地址提取表单字段，新建时填入中国大陆及空白资料。 */
function readDraft(address?: AddressDetail): AddressWriteInput {
  return {
    recipientName: address?.recipientName ?? "",
    phone: address?.phone ?? "",
    countryCode: address?.countryCode ?? "CN",
    province: address?.province ?? "",
    city: address?.city ?? "",
    district: address?.district ?? null,
    addressLine1: address?.addressLine1 ?? "",
    addressLine2: address?.addressLine2 ?? null,
    postalCode: address?.postalCode ?? null,
    remark: address?.remark ?? "",
    isDefault: address?.isDefault ?? false,
  };
}

/** 根据已有号码推断拨号地区，与收货地址的国家或地区独立。 */
function phoneCountryFrom(value: string) {
  return (
    readPhoneDraft(value, DEFAULT_PHONE_COUNTRY).number?.country ??
    DEFAULT_PHONE_COUNTRY
  );
}

/**
 * 提取服务端仍未应用的修改，比较电话号码时忽略显示格式。
 * @param base 比较所用的服务端地址版本。
 * @param input 待提交的完整表单或部分更新。
 * @returns 包含待保存字段的更新对象。
 */
function getPatch(base: AddressDetail, input: Partial<AddressWriteInput>) {
  return Object.fromEntries(
    addressFields.flatMap((field) => {
      const value = input[field];
      if (value === undefined || value === base[field]) return [];
      if (
        field === "phone" &&
        typeof value === "string" &&
        normalizeMobilePhone(value) === base.phoneNormalized
      ) {
        return [];
      }
      return [[field, value]];
    })
  ) as Partial<AddressWriteInput>;
}

function displayValue(
  field: AddressField,
  value: AddressWriteInput[AddressField]
) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (field === "countryCode") {
    return (
      addressCountries.find(({ code }) => code === value)?.name ?? value ?? ""
    );
  }
  return value ?? "";
}

type AddressFormProps = {
  address?: AddressDetail;
  customer?: AddressCustomer;
  onClose: () => void;
  onSaved: (address: AddressDetail) => void | Promise<void>;
};

/**
 * 从地址目录或客户地址列表新建、编辑收货地址。
 * @param props 初始地址、可选的所属客户、关闭与保存成功回调。
 * @returns 带默认地址确认及版本冲突处理的表单弹窗。
 */
export function AddressFormDialog({
  address,
  customer,
  onClose,
  onSaved,
}: AddressFormProps) {
  const id = useId();
  const dialogContent = useRef<HTMLDivElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState(
    address?.customer ?? customer ?? null
  );
  const [base, setBase] = useState(address);
  const [draft, setDraft] = useState(() => readDraft(address));
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() =>
    phoneCountryFrom(address?.phone ?? "")
  );
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  const phone = readPhoneDraft(draft.phone, phoneCountry);
  const country = addressCountries.find(
    ({ code }) => code === draft.countryCode
  );
  const regions = useMemo(
    () => getAddressRegions(draft.countryCode),
    [draft.countryCode]
  );
  const disabled = pending || saved;
  const versionPrompt = prompt?.kind === "version" ? prompt.submission : null;
  const differences = versionPrompt
    ? addressFields.flatMap((field) => {
        const proposed = versionPrompt.patch[field];
        return proposed === undefined
          ? []
          : [
              {
                label: fieldLabels[field],
                current: displayValue(field, versionPrompt.base[field]),
                proposed: displayValue(field, proposed),
              },
            ];
      })
    : null;

  function setField<FieldName extends AddressField>(
    field: FieldName,
    value: AddressWriteInput[FieldName]
  ) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setError("");
  }

  /**
   * 同步编辑基准并保留用户仍待保存的字段，取消冲突时仅更新本地状态。
   * @param current 服务端最新地址。
   * @param patch 当前草稿中仍待保存的字段。
   */
  function rebase(current: AddressDetail, patch: Partial<AddressWriteInput>) {
    setBase(current);
    setDraft((previous) => ({
      ...readDraft(current),
      ...patch,
      phone: patch.phone === undefined ? current.phone : previous.phone,
    }));
    if (patch.phone === undefined)
      setPhoneCountry(phoneCountryFrom(current.phone));
  }

  /**
   * 执行一次保存，遇到冲突时提供确认或同步最新版本。
   * @param submission 待提交的地址资料或带版本的修改。
   * @returns 请求及保存回调完成后结束，接口异常以表单消息展示。
   */
  async function save(submission: CreateSubmission | EditSubmission) {
    if (submitting.current || saved) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      let result: AddressDetail;
      try {
        const response =
          submission.kind === "create"
            ? await createAddress(
                submission.customerId,
                submission.input,
                submission.replaceExistingDefault
              )
            : await updateAddress(
                submission.base.id,
                submission.base.version,
                submission.patch
              );
        result = response.address;
      } catch (failure) {
        if (
          submission.kind === "create" &&
          !submission.replaceExistingDefault &&
          failure instanceof AddressApiError &&
          failure.code === "existing_default_conflict"
        ) {
          setPrompt({ kind: "replace-default", submission });
          return;
        }
        if (
          submission.kind === "edit" &&
          failure instanceof AddressApiError &&
          failure.code === "version_conflict" &&
          isAddressSnapshot(failure.current, submission.base.id)
        ) {
          const current = failure.current;
          const patch = getPatch(current, submission.patch);
          if (Object.keys(patch).length) {
            setPrompt({
              kind: "version",
              submission: { kind: "edit", base: current, patch },
            });
            return;
          }
          result = current;
        } else {
          setPrompt(null);
          setError(
            failure instanceof Error
              ? failure.message
              : "保存地址失败，请重试。"
          );
          return;
        }
      }
      setPrompt(null);
      setSaved(true);
      try {
        await onSaved(result);
      } catch {
        setError("地址已保存，但列表刷新失败。关闭弹窗后可重新加载。");
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt) return;
    if (!selectedCustomer) {
      setError("请选择客户。");
      return;
    }
    const normalizedPhone = normalizeMobilePhone(draft.phone, phoneCountry);
    if (!normalizedPhone) {
      setError(INVALID_MOBILE_PHONE_MESSAGE);
      return;
    }
    const rawPhone = draft.phone.trim();
    const rawPostalCode = draft.postalCode?.trim();
    const postalCode = rawPostalCode
      ? formatAddressPostalCode(draft.countryCode, rawPostalCode)
      : null;
    if (rawPostalCode && !postalCode) {
      setError("请输入与所选国家或地区匹配的有效邮政编码。");
      return;
    }
    const input: AddressWriteInput = {
      ...draft,
      recipientName: draft.recipientName.trim(),
      phone:
        normalizeMobilePhone(rawPhone) === normalizedPhone
          ? rawPhone
          : normalizedPhone,
      province: draft.province.trim(),
      city: draft.city.trim(),
      district: draft.district?.trim() || null,
      addressLine1: draft.addressLine1.trim(),
      addressLine2: draft.addressLine2?.trim() || null,
      postalCode,
      remark: draft.remark.trim(),
    };
    if (
      !input.recipientName ||
      !input.province ||
      !input.city ||
      !input.addressLine1
    ) {
      setError("请填写收货人、省或州、城市和详细地址。");
      return;
    }
    if (base) {
      const patch = getPatch(base, input);
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      void save({ kind: "edit", base, patch });
    } else {
      void save({
        kind: "create",
        customerId: selectedCustomer.id,
        input,
        replaceExistingDefault: false,
      });
    }
  }

  function closePrompt() {
    if (submitting.current) return;
    if (versionPrompt) rebase(versionPrompt.base, versionPrompt.patch);
    setPrompt(null);
  }

  function textField(field: TextField, maxLength: number, required = false) {
    return (
      <Field>
        <FieldLabel htmlFor={`${id}-${field}`}>{fieldLabels[field]}</FieldLabel>
        <Input
          id={`${id}-${field}`}
          value={draft[field] ?? ""}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          onChange={(event) => setField(field, event.target.value)}
        />
      </Field>
    );
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !submitting.current && !prompt) onClose();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl"
          ref={dialogContent}
          showCloseButton={!pending}
          onEscapeKeyDown={(event) => {
            // 已展开的下拉应先消费 Esc，避免关闭地址弹窗并丢弃草稿。
            if (
              dialogContent.current?.querySelector(
                '[role="combobox"][aria-expanded="true"]'
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{address ? "编辑地址" : "新建地址"}</DialogTitle>
            <DialogDescription className="sr-only">
              填写收货地址。
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-col gap-4" onSubmit={submit}>
            <div className="min-h-0 space-y-4 overflow-y-auto p-1">
              <CommunicationCustomerField
                value={selectedCustomer}
                locked={Boolean(address || customer)}
                disabled={disabled}
                portalContainer={dialogContent}
                onChange={(choice) => {
                  setSelectedCustomer(choice);
                  setError("");
                }}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {textField("recipientName", 128, true)}
                <Field>
                  <FieldLabel htmlFor={`${id}-phone`}>
                    {fieldLabels.phone}
                  </FieldLabel>
                  <PhoneNumberInput
                    id={`${id}-phone`}
                    value={draft.phone}
                    country={phone.number?.country ?? phoneCountry}
                    callingCode={phone.callingCode}
                    required
                    disabled={disabled}
                    type="tel"
                    maxLength={64}
                    onCountryChange={(next) => {
                      setPhoneCountry(next);
                      setField("phone", phone.nationalValue ?? draft.phone);
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      const parsed = readPhoneDraft(value, phoneCountry);
                      const normalized = parsed.international
                        ? normalizeMobilePhone(value, phoneCountry)
                        : undefined;
                      if (normalized && parsed.number?.country)
                        setPhoneCountry(parsed.number.country);
                      setField(
                        "phone",
                        normalized && !value.trimStart().startsWith("+")
                          ? normalized
                          : value
                      );
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-country`}>
                    {fieldLabels.countryCode}
                  </FieldLabel>
                  <Combobox
                    items={addressCountries}
                    value={country ?? null}
                    disabled={disabled}
                    autoHighlight
                    filter={matchesLocation}
                    itemToStringLabel={(option) => option.name}
                    onValueChange={(option) => {
                      if (option) setField("countryCode", option.code);
                    }}
                  >
                    <ComboboxInput
                      id={`${id}-country`}
                      className="w-full"
                      disabled={disabled}
                      onKeyDown={(event) => {
                        const input = event.currentTarget;
                        if (
                          event.key === "Enter" &&
                          input.getAttribute("aria-expanded") === "true" &&
                          !input.getAttribute("aria-activedescendant")
                        ) {
                          event.preventDefault();
                        }
                      }}
                    />
                    <ComboboxContent container={dialogContent}>
                      <ComboboxEmpty>没有匹配的国家或地区</ComboboxEmpty>
                      <ComboboxList>
                        {(option: LocationOption) => (
                          <ComboboxItem key={option.code} value={option}>
                            {option.name}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-province`}>
                    {fieldLabels.province}
                  </FieldLabel>
                  <Combobox
                    items={regions}
                    value={
                      regions.find(({ name }) => name === draft.province) ??
                      null
                    }
                    inputValue={draft.province}
                    disabled={disabled}
                    filter={matchesLocation}
                    itemToStringLabel={(option) => option.name}
                    onInputValueChange={(value, details) => {
                      if (details.reason === "input-change")
                        setField("province", value);
                    }}
                    onValueChange={(option) => {
                      if (option) setField("province", option.name);
                    }}
                  >
                    <ComboboxInput
                      id={`${id}-province`}
                      className="w-full"
                      maxLength={128}
                      required
                      disabled={disabled}
                    />
                    <ComboboxContent container={dialogContent}>
                      <ComboboxEmpty>可直接填写省或州</ComboboxEmpty>
                      <ComboboxList>
                        {(option: LocationOption) => (
                          <ComboboxItem key={option.name} value={option}>
                            {option.name}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>
                {textField("city", 128, true)}
                {textField("district", 128)}
                <div className="sm:col-span-2">
                  {textField("addressLine1", 256, true)}
                </div>
                {textField("addressLine2", 256)}
                {textField("postalCode", 32)}
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-remark`}>
                  {fieldLabels.remark}
                </FieldLabel>
                <Textarea
                  id={`${id}-remark`}
                  value={draft.remark}
                  disabled={disabled}
                  maxLength={4096}
                  onChange={(event) => setField("remark", event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-default`}
                  checked={draft.isDefault}
                  disabled={disabled || base?.isDefault}
                  onCheckedChange={(checked) =>
                    setField("isDefault", checked === true)
                  }
                />
                <FieldLabel htmlFor={`${id}-default`}>
                  {fieldLabels.isDefault}
                </FieldLabel>
              </Field>
              {error && <FieldError>{error}</FieldError>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                disabled={pending}
                onClick={onClose}
              >
                {saved ? "关闭" : "取消"}
              </Button>
              <Button type="submit" disabled={disabled}>
                {pending ? "正在保存…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={prompt?.kind === "replace-default"}
        onOpenChange={(open) => {
          if (!open) closePrompt();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>替换默认地址</AlertDialogTitle>
            <AlertDialogDescription>
              该客户已有默认地址。确认后，新地址将成为默认地址。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (prompt?.kind !== "replace-default") return;
                void save({
                  ...prompt.submission,
                  replaceExistingDefault: true,
                });
              }}
            >
              {pending ? "正在保存…" : "确认替换"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <VersionConflictDialog
        differences={differences}
        description="这条地址已被更新。覆盖时仅提交下方字段，取消后可继续编辑。"
        pending={pending}
        onCancel={closePrompt}
        onOverwrite={() => {
          if (!versionPrompt || submitting.current) return;
          rebase(versionPrompt.base, versionPrompt.patch);
          void save(versionPrompt);
        }}
      />
    </>
  );
}
