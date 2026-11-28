import { productType } from "@repo/db/schema";

import { validateRequiredText } from "../../shared/required-text";
import {
  isPresetProductTypeName,
  trimCustomerDefinedType,
  validateProductTypeFields,
} from "./type-fields";
import type { ProductFields, ProductPatch, ProductType } from "./type-fields";

type ProductFieldsIssue =
  | { message: string }
  | { typeFields: NonNullable<ReturnType<typeof validateProductTypeFields>> };

export class ProductFieldsError extends Error {
  constructor(readonly issue: ProductFieldsIssue) {
    super(
      "message" in issue
        ? issue.message
        : `产品类型字段校验失败：${issue.typeFields}`
    );
    this.name = "ProductFieldsError";
  }
}

function rejectProductField(message: string): never {
  throw new ProductFieldsError({ message });
}

function readRequiredText(value: unknown, label: string, max: number) {
  const result = validateRequiredText(value, label, max);
  if (!result.ok) rejectProductField(result.message);
  return result.value;
}

// 与参考项目使用同一 ISO 4217 币种清单，排除基金、贵金属和测试代码。
const currencyCodes = new Set(
  `AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND
   BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE
   CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD
   GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY
   KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD
   MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO
   NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF
   SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB
   TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND
   VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG`.split(/\s+/u)
);

/** 校验产品类型代码，供列表筛选和写入共用。 */
export function prepareProductType(value: unknown): ProductType {
  const type = productType.enumValues.find((candidate) => candidate === value);
  if (!type) rejectProductField("请选择有效的产品类型。");
  return type;
}

function readEnglishName(value: unknown) {
  const name = readRequiredText(value, "产品英文名称", 128);
  if ([...name].length < 3)
    rejectProductField("产品英文名称至少需要 3 个字符。");
  return name;
}

function readCustomerDefinedType(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") rejectProductField("请填写自定义类型名称。");

  const name = readRequiredText(
    trimCustomerDefinedType(value),
    "自定义类型名称",
    64
  );
  if (isPresetProductTypeName(name)) {
    rejectProductField("该名称属于预设类型，请直接选择对应的产品类型。");
  }
  return name;
}

function readCurrencyCode(value: unknown) {
  const code = readRequiredText(value, "币种", 3).toUpperCase();
  if (!currencyCodes.has(code))
    rejectProductField("请选择有效的 ISO 4217 币种。");
  return code;
}

function readUnitPrice(value: unknown) {
  const text =
    typeof value === "number" || typeof value === "string"
      ? String(value).trim()
      : "";
  const parts = /^(\d+)(?:\.(\d{1,4}))?$/u.exec(text);
  if (!parts?.[1]) rejectProductField("请输入有效的单价，最多保留 4 位小数。");
  const price = Number(text);
  if (price <= 0 || price > 100_000) {
    rejectProductField("产品单价必须大于 0 且不超过 100000。");
  }
  // 统一请求指纹与入库金额，保留精确的十进制表示。
  const whole = parts[1].replace(/^0+(?=\d)/u, "");
  const fraction = parts[2]?.replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function readPeelOffQuantity(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    rejectProductField("揭开口数量须为有效的正整数。");
  }
  return value;
}

function readRemark(value: unknown) {
  if (typeof value !== "string") rejectProductField("产品备注须为文本。");
  const remark = value.trim();
  if (remark.length > 4096 || remark.includes("\0")) {
    rejectProductField("请检查产品备注，最多可填写 4096 个字符。");
  }
  return remark;
}

const productFieldReaders = {
  name: (value: unknown) => readRequiredText(value, "产品名称", 128),
  englishName: readEnglishName,
  productType: prepareProductType,
  customerDefinedType: readCustomerDefinedType,
  specification: (value: unknown) => readRequiredText(value, "产品规格", 128),
  packagingSpecification: (value: unknown) =>
    readRequiredText(value, "包装规格", 128),
  colorCount: (value: unknown) => readRequiredText(value, "色数", 32),
  paperType: (value: unknown) => readRequiredText(value, "纸张类型", 64),
  finishedSize: (value: unknown) => readRequiredText(value, "成品尺寸", 64),
  finalMolding: (value: unknown) => readRequiredText(value, "最后成型", 64),
  surfaceTreatment: (value: unknown) => readRequiredText(value, "表面处理", 64),
  variableColor: (value: unknown) => readRequiredText(value, "可变颜色", 64),
  variationMethod: (value: unknown) => readRequiredText(value, "变化方式", 64),
  dieCutDirection: (value: unknown) =>
    value === null ? null : readRequiredText(value, "模切方向", 32),
  peelOffQuantity: readPeelOffQuantity,
  scratchOffArea: (value: unknown) =>
    value === null ? null : readRequiredText(value, "刮刮区", 64),
  currencyCode: readCurrencyCode,
  unitPrice: readUnitPrice,
  remark: readRemark,
} satisfies {
  [Key in keyof ProductFields]: (value: unknown) => ProductFields[Key];
};

export const productWriteFields = Object.keys(
  productFieldReaders
) as (keyof ProductFields)[];

function readProductFields(
  body: Record<string, unknown>,
  fields: readonly (keyof ProductFields)[]
) {
  return Object.fromEntries(
    fields.map((field) => [field, productFieldReaders[field](body[field])])
  );
}

/** 读取新建产品的完整资料，使用固定字段顺序生成规范化输入。 */
export function prepareProductCreateFields(
  body: Record<string, unknown>
): ProductFields {
  const fields = readProductFields(
    {
      customerDefinedType: null,
      dieCutDirection: null,
      peelOffQuantity: null,
      scratchOffArea: null,
      remark: "",
      ...body,
    },
    productWriteFields
  ) as ProductFields;
  const reason = validateProductTypeFields(fields);
  if (reason) throw new ProductFieldsError({ typeFields: reason });
  return fields;
}

/** 解析 PATCH 提供的字段，与锁定的产品资料合并后再校验字段间依赖。 */
export function prepareProductPatch(
  body: Record<string, unknown>
): ProductPatch {
  const fields = productWriteFields.filter((field) =>
    Object.hasOwn(body, field)
  );
  if (!fields.length) rejectProductField("请提交需要更新的产品资料。");
  return readProductFields(body, fields);
}
