import {
  type CountryCode,
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/server";
import { CircleAlert, Save } from "lucide-react";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import { CustomerSelectField } from "@/components/shared/customer-select-field";
import {
  PhoneNumberInput,
  readPhoneDraft,
} from "@/components/shared/phone-number-input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createUuid } from "@/lib/uuid";
import {
  AddressApiError,
  type AddressCustomer,
  type AddressDetail,
  type AddressWriteInput,
  createAddress,
  type ExpectedDefaultAddress,
  isAddressSnapshot,
  updateAddress,
} from "@/request/addresses";
import {
  addressCountries,
  formatAddressPostalCode,
  getAddressRegions,
} from "./geography";
import { addressFormPageClass } from "./load-state";

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
type CreateSubmission = {
  kind: "create";
  submissionId: string;
  customerId: string;
  input: AddressWriteInput;
  expectedDefault?: ExpectedDefaultAddress;
};
type EditSubmission = {
  kind: "edit";
  base: AddressDetail;
  patch: Partial<AddressWriteInput>;
};
type Prompt =
  | {
      kind: "replace-default";
      submission: CreateSubmission;
      current: AddressDetail | null;
    }
  | { kind: "version"; submission: EditSubmission };

const addressFields = Object.keys(fieldLabels) as AddressField[];

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
  const patch = Object.fromEntries(
    addressFields.flatMap((field) => {
      const value = input[field];
      if (value === undefined || value === base[field]) return [];
      if (field === "province" && value === "") return [];
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
  // 更换国家或省州时，重填的下级地址字段即使与原值相同也要提交。
  if (patch.countryCode !== undefined) patch.province = input.province ?? "";
  if (patch.countryCode !== undefined || patch.province !== undefined) {
    patch.city = input.city;
    patch.district = input.district;
    patch.postalCode = input.postalCode;
  }
  return patch;
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
 * 在独立页面新建地址，也可从已选客户的地址列表发起。
 * @param props 可选的所属客户，以及取消与保存成功后的导航回调。
 * @returns 新建地址页面和替换默认地址的确认弹窗。
 */
export function AddressCreateForm({
  onCancel,
  ...props
}: Omit<AddressFormProps, "address" | "onClose"> & { onCancel: () => void }) {
  return <AddressForm {...props} onClose={onCancel} />;
}

export function AddressEditForm({
  onCancel,
  ...props
}: Pick<AddressFormProps, "onSaved"> & {
  address: AddressDetail;
  onCancel: () => void;
}) {
  return <AddressForm {...props} onClose={onCancel} />;
}

function AddressForm({
  address,
  customer,
  onClose,
  onSaved,
}: AddressFormProps) {
  const id = useId();
  const [selectedCustomer, setSelectedCustomer] = useState(
    address?.customer ?? customer ?? null
  );
  const [base, setBase] = useState(address);
  const [draft, setDraft] = useState(() => readDraft(address));
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() =>
    phoneCountryFrom(address?.phone ?? "")
  );
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const creation = useRef<{ id: string; signature: string } | null>(null);

  const phone = readPhoneDraft(draft.phone, phoneCountry);
  const country = addressCountries.find(
    ({ code }) => code === draft.countryCode
  );
  const regions = useMemo(() => {
    const options = getAddressRegions(draft.countryCode);
    if (
      !draft.province ||
      options.some(({ name }) => name === draft.province)
    ) {
      return options;
    }
    // 旧地址的自填省名作为当前选项保留，方便只编辑其他字段。
    return [{ code: "", name: draft.province, keywords: "" }, ...options];
  }, [draft.countryCode, draft.province]);
  const disabled = pending || saved;
  const defaultPrompt = prompt?.kind === "replace-default" ? prompt : null;
  const defaultChanged =
    defaultPrompt?.submission.expectedDefault !== undefined;
  const versionPrompt = prompt?.kind === "version" ? prompt.submission : null;
  const differences = versionPrompt
    ? addressFields.flatMap((field) => {
        const proposed = versionPrompt.patch[field];
        return proposed === undefined || proposed === versionPrompt.base[field]
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

  function confirmProvince(province: string) {
    setDraft((previous) => {
      const currentProvince = previous.province.trim();
      if (province === currentProvince) return previous;
      return currentProvince
        ? { ...previous, province, city: "", district: null, postalCode: null }
        : { ...previous, province };
    });
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
                submission.submissionId,
                submission.expectedDefault
              )
            : await updateAddress(
                submission.base.id,
                submission.base.version,
                submission.patch
              );
        result = response.address;
      } catch (failure) {
        const current =
          failure instanceof AddressApiError ? failure.current : undefined;
        if (
          submission.kind === "create" &&
          failure instanceof AddressApiError &&
          failure.status === 409 &&
          failure.code === "existing_default_conflict" &&
          (current === null ||
            (isAddressSnapshot(current) &&
              current.customerId === submission.customerId &&
              current.isDefault &&
              current.status === "active"))
        ) {
          setPrompt({ kind: "replace-default", submission, current });
          return;
        }
        if (
          submission.kind === "edit" &&
          failure instanceof AddressApiError &&
          failure.code === "version_conflict" &&
          isAddressSnapshot(current, submission.base.id)
        ) {
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
          if (
            failure instanceof AddressApiError &&
            failure.status === 400 &&
            failure.message === INVALID_MOBILE_PHONE_MESSAGE
          ) {
            setPhoneInvalid(true);
            return;
          }
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
        setError("地址已保存，页面加载失败。请返回后刷新查看。");
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt) return;
    setPhoneInvalid(false);
    if (!selectedCustomer) {
      setError("请选择客户。");
      return;
    }
    const normalizedPhone = normalizeMobilePhone(draft.phone, phoneCountry);
    if (!normalizedPhone) {
      setError("");
      setPhoneInvalid(true);
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
    const provinceRequired =
      !base ||
      (base.countryCode === input.countryCode && Boolean(base.province));
    if (
      !input.recipientName ||
      (provinceRequired && !input.province) ||
      !input.city ||
      !input.addressLine1
    ) {
      setError(
        provinceRequired
          ? "请填写收货人、省或州、城市和详细地址。"
          : "请填写收货人、城市和详细地址。"
      );
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
      const customerId = selectedCustomer.id;
      const signature = JSON.stringify({ customerId, ...input });
      // 同一份新建资料的重试和默认地址确认复用提交 ID。
      if (creation.current?.signature !== signature) {
        creation.current = { id: createUuid(), signature };
      }
      void save({
        kind: "create",
        submissionId: creation.current.id,
        customerId,
        input,
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

  const fields = (
    <>
      <CustomerSelectField
        value={selectedCustomer}
        locked={Boolean(address || customer)}
        disabled={disabled}
        controlClassName="h-8"
        onChange={(choice) => {
          setSelectedCustomer(choice);
          setError("");
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {textField("recipientName", 128, true)}
        <Field data-invalid={phoneInvalid || undefined}>
          <FieldLabel htmlFor={`${id}-phone`}>{fieldLabels.phone}</FieldLabel>
          <div className="relative">
            <PhoneNumberInput
              id={`${id}-phone`}
              value={draft.phone}
              country={phone.number?.country ?? phoneCountry}
              callingCode={phone.callingCode}
              required
              disabled={disabled}
              type="tel"
              maxLength={64}
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={phoneInvalid ? `${id}-phone-error` : undefined}
              className={
                phoneInvalid ? "pr-8 pointer-coarse:pr-2.5" : undefined
              }
              onCountryChange={(next) => {
                setPhoneInvalid(false);
                setPhoneCountry(next);
                setField("phone", phone.nationalValue ?? draft.phone);
              }}
              onChange={(event) => {
                setPhoneInvalid(false);
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
            {phoneInvalid && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-destructive hover:text-destructive pointer-coarse:hidden"
                    aria-label="查看联系电话错误"
                  >
                    <CircleAlert aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={5}>
                  {INVALID_MOBILE_PHONE_MESSAGE}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {phoneInvalid && (
            <FieldError
              id={`${id}-phone-error`}
              className="sr-only pointer-coarse:not-sr-only"
            >
              {INVALID_MOBILE_PHONE_MESSAGE}
            </FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-country`} preventControlActivation>
            {fieldLabels.countryCode}
          </FieldLabel>
          <SearchableSelect
            id={`${id}-country`}
            items={addressCountries}
            value={country ?? null}
            placeholder="请选择国家或地区"
            searchPlaceholder="搜索国家或地区名称或代码"
            emptyMessage="没有匹配的国家或地区"
            prioritizeCodeMatch
            disabled={disabled}
            onValueChange={(option) => {
              if (option.code === draft.countryCode) return;
              setDraft((previous) => ({
                ...previous,
                countryCode: option.code,
                province: "",
                city: "",
                district: null,
                postalCode: null,
              }));
              setError("");
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-province`} preventControlActivation>
            {fieldLabels.province}
          </FieldLabel>
          <SearchableSelect
            id={`${id}-province`}
            items={regions}
            value={regions.find(({ name }) => name === draft.province) ?? null}
            placeholder="请选择省/州"
            searchPlaceholder="搜索省/州名称或代码"
            emptyMessage="没有匹配的省或州"
            prioritizeCodeMatch
            disabled={disabled}
            onValueChange={(option) => confirmProvince(option.name)}
          />
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
        <FieldLabel htmlFor={`${id}-remark`}>{fieldLabels.remark}</FieldLabel>
        <Textarea
          id={`${id}-remark`}
          className="min-h-36"
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
          onCheckedChange={(checked) => setField("isDefault", checked === true)}
        />
        <FieldLabel htmlFor={`${id}-default`}>
          {fieldLabels.isDefault}
        </FieldLabel>
      </Field>
    </>
  );
  const errorAlert = error && (
    <FieldError className="shrink-0 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
      {error}
    </FieldError>
  );
  const actions = (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={onClose}
      >
        {saved ? "关闭" : "取消"}
      </Button>
      <Button type="submit" disabled={disabled} aria-busy={pending}>
        <Save aria-hidden="true" />
        {pending ? "正在保存…" : "保存"}
      </Button>
    </>
  );

  return (
    <>
      <main className={addressFormPageClass}>
        <form className="space-y-5" onSubmit={submit}>
          <header className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">
              {address ? "编辑地址" : "新建地址"}
            </h1>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
          {errorAlert}
          {fields}
        </form>
      </main>
      <AlertDialog
        open={defaultPrompt !== null}
        onOpenChange={(open) => {
          if (!open) closePrompt();
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {defaultChanged ? "默认地址已变更" : "替换默认地址"}
            </AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {defaultPrompt?.current
                ? "确认后，新地址将替换下方的默认地址。"
                : "该客户当前没有默认地址。确认后，新地址将设为默认。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {defaultPrompt?.current && (
            <div
              className="max-h-[45vh] space-y-1 overflow-y-auto rounded-lg border p-3 text-sm"
              aria-live="polite"
            >
              <p className="font-medium">当前默认地址</p>
              <p className="flex flex-wrap gap-x-2">
                <span className="wrap-anywhere">
                  {defaultPrompt.current.recipientName}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {defaultPrompt.current.phone}
                </span>
              </p>
              <p className="wrap-anywhere text-muted-foreground">
                {defaultPrompt.current.formattedAddress}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (!defaultPrompt) return;
                const { current, submission } = defaultPrompt;
                void save({
                  ...submission,
                  expectedDefault: current
                    ? { id: current.id, version: current.version }
                    : null,
                });
              }}
            >
              {pending ? "正在保存…" : defaultChanged ? "确认覆盖" : "确认替换"}
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
