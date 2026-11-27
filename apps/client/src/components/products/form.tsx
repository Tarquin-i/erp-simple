import { Save } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";

import { CustomerSelectField } from "@/components/shared/customer-select-field";
import type { CustomerChoice } from "@/components/shared/customer-select-field";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { isProductType, productTypeLabels } from "@/request/products";
import type {
  ProductCreateInput,
  ProductDetailRecord,
  ProductType,
  ProductWriteInput,
} from "@/request/products";

import { productAttributes, readProductAttributeOptions } from "./form-options";
import type { ProductAttributeField } from "./form-options";
import { ProductPresetField } from "./preset-field";
import type { ProductPresetOption } from "./preset-field";

export const productFieldLabels = {
  name: "产品名称",
  englishName: "英文名称",
  productType: "产品类型",
  customerDefinedType: "自定义类型名称",
  specification: "产品规格",
  packagingSpecification: "包装规格",
  colorCount: "色数",
  paperType: "纸张类型",
  finishedSize: "成品尺寸",
  finalMolding: "最后成型",
  surfaceTreatment: "表面处理",
  variableColor: "可变颜色",
  variationMethod: "变化方式",
  dieCutDirection: "模切方向",
  peelOffQuantity: "揭开口数量",
  scratchOffArea: "刮刮区",
  currencyCode: "币种",
  unitPrice: "单价",
  remark: "备注",
} satisfies Record<keyof ProductWriteInput, string>;

export type ProductDraft = Omit<
  ProductWriteInput,
  "productType" | "peelOffQuantity"
> & {
  customer: CustomerChoice | null;
  productType: ProductType | "";
  peelOffQuantity: string;
};

type ProductTextField = "name" | "englishName" | "packagingSpecification";

const specificationFields = [
  "specification",
  "finishedSize",
  "paperType",
  "colorCount",
  "surfaceTreatment",
  "finalMolding",
  "variableColor",
  "variationMethod",
] as const satisfies readonly ProductAttributeField[];
const requiredFields = [
  "name",
  "englishName",
  ...specificationFields,
  "packagingSpecification",
] as const;

const productTypes = (Object.keys(productTypeLabels) as ProductType[])
  .filter((type) => type !== "user-defined")
  .map((value) => ({ value, name: productTypeLabels[value] }));
const presetTypeNames = new Set(
  productTypes.flatMap(({ name, value }) => [name, value.toLowerCase()])
);

function validateCustomProductType(value: string) {
  return presetTypeNames.has(value.toLowerCase())
    ? "该名称属于预设类型，请直接选择对应的产品类型。"
    : undefined;
}

function isValidPeelOffQuantity(value: string) {
  const quantity = Number(value);
  return (
    /^\d+$/u.test(value.trim()) && quantity > 0 && quantity <= 2_147_483_647
  );
}

// 与产品接口的 ISO 4217 币种清单一致。
const currencyCodes =
  `AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND
  BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE
  CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD
  GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY
  KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD
  MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO
  NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF
  SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB
  TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND
  VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG`.split(/\s+/u);
const currencyNames = new Intl.DisplayNames("zh-CN", { type: "currency" });
const currencies = currencyCodes.map((code) => ({
  code,
  name: `${currencyNames.of(code)}（${code}）`,
  keywords: code,
}));

const needsScratchOffArea = (type: ProductDraft["productType"]) =>
  type === "scratch-card" || type === "lottery";

export function readProductDraft(product?: ProductDetailRecord): ProductDraft {
  const price = product?.unitPrice ?? "";
  return {
    customer: product?.customer ?? null,
    name: product?.name ?? "",
    englishName: product?.englishName ?? "",
    productType: product?.productType ?? "",
    customerDefinedType: product?.customerDefinedType ?? null,
    specification: product?.specification ?? "",
    packagingSpecification: product?.packagingSpecification ?? "",
    colorCount: product?.colorCount ?? "",
    paperType: product?.paperType ?? "",
    finishedSize: product?.finishedSize ?? "",
    finalMolding: product?.finalMolding ?? "",
    surfaceTreatment: product?.surfaceTreatment ?? "",
    variableColor: product?.variableColor ?? "",
    variationMethod: product?.variationMethod ?? "",
    dieCutDirection: product?.dieCutDirection ?? null,
    peelOffQuantity: product?.peelOffQuantity?.toString() ?? "",
    scratchOffArea: product?.scratchOffArea ?? null,
    currencyCode: product?.currencyCode ?? "CNY",
    unitPrice: price.includes(".")
      ? price.replace(/0+$/u, "").replace(/\.$/u, "")
      : price,
    remark: product?.remark ?? "",
  };
}

type ProductFormProps = {
  title: string;
  draft: ProductDraft;
  onDraftChange: (draft: ProductDraft) => void;
  onSubmit: (input: ProductCreateInput) => void;
  onCancel: () => void;
  customerLocked?: boolean;
  fieldsLocked?: boolean;
  pending?: boolean;
  disabled?: boolean;
  saveLabel?: string;
  error?: string;
  fieldError?: "name" | "englishName";
};

/** 在同一个表单中编辑基础信息、规格工艺和价格。 */
export function ProductForm({
  title,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  customerLocked = false,
  fieldsLocked = false,
  pending = false,
  disabled = false,
  saveLabel = "保存",
  error,
  fieldError,
}: ProductFormProps) {
  const id = useId();
  const [validationError, setValidationError] = useState("");
  const locked = disabled || pending;
  const controlsDisabled = locked || fieldsLocked;
  const formError = validationError || error;
  const formErrorId = `${id}-form-error`;
  const selectedType: ProductPresetOption | null =
    draft.productType === "user-defined" && draft.customerDefinedType
      ? { name: draft.customerDefinedType, value: draft.productType }
      : (productTypes.find(({ value }) => value === draft.productType) ?? null);

  useEffect(() => {
    if (fieldError && error && !controlsDisabled) {
      document.getElementById(`${id}-${fieldError}`)?.focus();
    }
  }, [controlsDisabled, error, fieldError, id]);

  function changeDraft(next: ProductDraft) {
    setValidationError("");
    onDraftChange(next);
  }

  function changeType(
    productType: ProductType,
    customerDefinedType: string | null = null
  ) {
    if (
      productType === draft.productType &&
      customerDefinedType === draft.customerDefinedType
    ) {
      return;
    }
    changeDraft({
      ...draft,
      productType,
      customerDefinedType,
      finishedSize: "",
      dieCutDirection:
        productType === "pull-tab" ? draft.dieCutDirection : null,
      peelOffQuantity: productType === "pull-tab" ? draft.peelOffQuantity : "",
      scratchOffArea: needsScratchOffArea(productType)
        ? draft.scratchOffArea
        : null,
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;

    const { customer, productType, ...fields } = draft;
    if (!customer || !productType) {
      setValidationError(!customer ? "请选择客户。" : "请选择产品类型。");
      return;
    }

    for (const field of requiredFields) {
      fields[field] = fields[field].trim();
      if (!fields[field]) {
        setValidationError(`请填写${productFieldLabels[field]}。`);
        return;
      }
    }
    if (Array.from(fields.englishName).length < 3) {
      setValidationError("英文名称至少需要 3 个字符。");
      return;
    }

    const customerDefinedType =
      productType === "user-defined"
        ? fields.customerDefinedType?.trim()
        : null;
    if (productType === "user-defined" && !customerDefinedType) {
      setValidationError("请填写自定义类型名称。");
      return;
    }

    const dieCutDirection =
      productType === "pull-tab" ? fields.dieCutDirection?.trim() : null;
    const peelOffQuantity =
      productType === "pull-tab" ? Number(fields.peelOffQuantity) : null;
    if (
      productType === "pull-tab" &&
      (!dieCutDirection || !isValidPeelOffQuantity(fields.peelOffQuantity))
    ) {
      setValidationError("请填写模切方向和有效的正整数揭开口数量。");
      return;
    }

    const scratchOffArea = needsScratchOffArea(productType)
      ? fields.scratchOffArea?.trim()
      : null;
    if (needsScratchOffArea(productType) && !scratchOffArea) {
      setValidationError("请填写刮刮区。");
      return;
    }

    const unitPrice = fields.unitPrice.trim();
    if (
      !/^\d+(?:\.\d{1,4})?$/u.test(unitPrice) ||
      Number(unitPrice) <= 0 ||
      Number(unitPrice) > 100_000
    ) {
      setValidationError("单价必须大于 0 且不超过 100000，最多保留 4 位小数。");
      return;
    }

    setValidationError("");
    onSubmit({
      ...fields,
      customerId: customer.id,
      productType,
      customerDefinedType: customerDefinedType || null,
      dieCutDirection: dieCutDirection || null,
      peelOffQuantity,
      scratchOffArea: scratchOffArea || null,
      unitPrice,
      remark: fields.remark.trim(),
    });
  }

  function textField(field: ProductTextField, maxLength: number) {
    const inputId = `${id}-${field}`;
    const invalid = fieldError === field && Boolean(error);
    return (
      <Field key={field} data-invalid={invalid || undefined}>
        <FieldLabel htmlFor={inputId}>{productFieldLabels[field]}</FieldLabel>
        <Input
          id={inputId}
          value={draft[field] ?? ""}
          required
          maxLength={maxLength}
          disabled={controlsDisabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? formErrorId : undefined}
          onChange={(event) =>
            changeDraft({ ...draft, [field]: event.target.value })
          }
        />
      </Field>
    );
  }

  function attributeField(field: ProductAttributeField) {
    const { maxLength, allowCustom } = productAttributes[field];
    const options = readProductAttributeOptions(field, draft.productType);
    const current = draft[field] ?? "";
    const isQuantity = field === "peelOffQuantity";
    const changeValue = (value: string) => {
      if (current !== value) changeDraft({ ...draft, [field]: value });
    };
    return (
      <ProductPresetField
        key={field}
        id={`${id}-${field}`}
        label={productFieldLabels[field]}
        items={options.map((value) => ({ name: value, value }))}
        value={current ? { name: current, value: current } : null}
        disabled={controlsDisabled}
        onChange={({ value }) => changeValue(value)}
        custom={
          allowCustom
            ? {
                initialValue: options.includes(current) ? "" : current,
                maxLength,
                inputMode: isQuantity ? "numeric" : undefined,
                validate: isQuantity
                  ? (value) =>
                      isValidPeelOffQuantity(value)
                        ? undefined
                        : "请输入有效的正整数揭开口数量。"
                  : undefined,
                onConfirm: (value) =>
                  changeValue(isQuantity ? String(Number(value)) : value),
              }
            : undefined
        }
      />
    );
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form className="space-y-5" onSubmit={submit}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button type="submit" disabled={locked} aria-busy={pending}>
              <Save aria-hidden="true" />
              {pending ? "正在保存…" : saveLabel}
            </Button>
          </div>
        </header>

        {formError && (
          <FieldError
            id={formErrorId}
            className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2"
          >
            {formError}
          </FieldError>
        )}

        <FieldSet>
          <FieldLegend className="mb-2">基础信息</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("name", 128)}
            {textField("englishName", 128)}
            <CustomerSelectField
              value={draft.customer}
              locked={customerLocked}
              disabled={controlsDisabled}
              controlClassName="h-8"
              onChange={(customer) => changeDraft({ ...draft, customer })}
            />
            <ProductPresetField
              id={`${id}-type`}
              label="产品类型"
              items={productTypes}
              value={selectedType}
              disabled={controlsDisabled}
              onChange={({ value }) => {
                if (isProductType(value) && value !== "user-defined") {
                  changeType(value);
                }
              }}
              custom={{
                initialValue: draft.customerDefinedType ?? "",
                label: "自定义类型名称",
                maxLength: 64,
                validate: validateCustomProductType,
                onConfirm: (value) => changeType("user-defined", value),
              }}
            />
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend className="mb-2">规格工艺</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {specificationFields.map(attributeField)}
            {textField("packagingSpecification", 128)}
            {draft.productType === "pull-tab" && (
              <>
                {attributeField("dieCutDirection")}
                {attributeField("peelOffQuantity")}
              </>
            )}
            {needsScratchOffArea(draft.productType) &&
              attributeField("scratchOffArea")}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend className="mb-2">价格</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-currency`} preventControlActivation>
                币种
              </FieldLabel>
              <SearchableSelect
                id={`${id}-currency`}
                items={currencies}
                value={
                  currencies.find(({ code }) => code === draft.currencyCode) ??
                  null
                }
                placeholder="请选择币种"
                searchPlaceholder="搜索币种名称或代码"
                emptyMessage="没有匹配的币种"
                prioritizeCodeMatch
                disabled={controlsDisabled}
                required
                onValueChange={({ code }) =>
                  changeDraft({ ...draft, currencyCode: code })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-price`}>单价</FieldLabel>
              <Input
                id={`${id}-price`}
                inputMode="decimal"
                value={draft.unitPrice}
                maxLength={16}
                required
                disabled={controlsDisabled}
                onChange={(event) =>
                  changeDraft({ ...draft, unitPrice: event.target.value })
                }
              />
            </Field>
          </div>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor={`${id}-remark`}>备注</FieldLabel>
          <Textarea
            id={`${id}-remark`}
            value={draft.remark}
            maxLength={4096}
            disabled={controlsDisabled}
            onChange={(event) =>
              changeDraft({ ...draft, remark: event.target.value })
            }
          />
        </Field>
      </form>
    </main>
  );
}
