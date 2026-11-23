import { Save } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";

import { CommunicationCustomerField } from "@/components/communication/form/customer-field";
import type { CustomerChoice } from "@/components/communication/form/customer-field";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { productTypeLabels } from "@/request/products";
import type {
  ProductCreateInput,
  ProductDetailRecord,
  ProductType,
  ProductWriteInput,
} from "@/request/products";

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

type ProductTextField = Exclude<
  keyof ProductWriteInput,
  "productType" | "currencyCode" | "unitPrice" | "remark"
>;

const specificationFields = [
  ["specification", 128],
  ["finishedSize", 64],
  ["paperType", 64],
  ["colorCount", 32],
  ["surfaceTreatment", 64],
  ["finalMolding", 64],
  ["variableColor", 64],
  ["variationMethod", 64],
  ["packagingSpecification", 128],
] as const;
const requiredFields = [
  "name",
  "englishName",
  ...specificationFields.map(([key]) => key),
] as const;

const productTypes = (Object.keys(productTypeLabels) as ProductType[]).map(
  (code) => ({ code, name: productTypeLabels[code] })
);

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
  const formError = validationError || (fieldError ? undefined : error);

  useEffect(() => {
    if (fieldError && error && !controlsDisabled) {
      document.getElementById(`${id}-${fieldError}`)?.focus();
    }
  }, [controlsDisabled, error, fieldError, id]);

  function changeDraft(next: ProductDraft) {
    setValidationError("");
    onDraftChange(next);
  }

  function changeType(productType: ProductType) {
    if (productType === draft.productType) return;
    changeDraft({
      ...draft,
      productType,
      customerDefinedType:
        productType === "user-defined" ? draft.customerDefinedType : null,
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
      (!dieCutDirection ||
        !/^\d+$/u.test(fields.peelOffQuantity.trim()) ||
        peelOffQuantity === null ||
        peelOffQuantity < 1 ||
        peelOffQuantity > 2147483647)
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
    const issue = fieldError === field ? error : undefined;
    return (
      <Field key={field} data-invalid={issue ? true : undefined}>
        <FieldLabel htmlFor={inputId}>{productFieldLabels[field]}</FieldLabel>
        <Input
          id={inputId}
          value={draft[field] ?? ""}
          required
          maxLength={maxLength}
          inputMode={field === "peelOffQuantity" ? "numeric" : undefined}
          disabled={controlsDisabled}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? `${inputId}-error` : undefined}
          onChange={(event) =>
            changeDraft({ ...draft, [field]: event.target.value })
          }
        />
        {issue && <FieldError id={`${inputId}-error`}>{issue}</FieldError>}
      </Field>
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
              className="h-10 px-4"
              disabled={pending}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-10 px-4"
              disabled={locked}
              aria-busy={pending}
            >
              <Save aria-hidden="true" />
              {pending ? "正在保存…" : saveLabel}
            </Button>
          </div>
        </header>

        {formError && (
          <FieldError className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
            {formError}
          </FieldError>
        )}

        <FieldSet>
          <FieldLegend>基础信息</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("name", 128)}
            {textField("englishName", 128)}
            <CommunicationCustomerField
              value={draft.customer}
              locked={customerLocked}
              disabled={controlsDisabled}
              onChange={(customer) => changeDraft({ ...draft, customer })}
            />
            <Field>
              <FieldLabel htmlFor={`${id}-type`}>产品类型</FieldLabel>
              <SearchableSelect
                id={`${id}-type`}
                items={productTypes}
                value={
                  productTypes.find(({ code }) => code === draft.productType) ??
                  null
                }
                placeholder="请选择产品类型"
                searchPlaceholder="搜索产品类型"
                emptyMessage="没有匹配的产品类型"
                disabled={controlsDisabled}
                required
                onValueChange={({ code }) => changeType(code)}
              />
            </Field>
            {draft.productType === "user-defined" &&
              textField("customerDefinedType", 64)}
          </div>
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
        </FieldSet>

        <FieldSet>
          <FieldLegend>规格工艺</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {specificationFields.map(([field, limit]) =>
              textField(field, limit)
            )}
            {draft.productType === "pull-tab" && (
              <>
                {textField("dieCutDirection", 32)}
                {textField("peelOffQuantity", 10)}
              </>
            )}
            {needsScratchOffArea(draft.productType) &&
              textField("scratchOffArea", 64)}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend>价格</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-currency`}>币种</FieldLabel>
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
      </form>
    </main>
  );
}
