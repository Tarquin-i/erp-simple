import { productType } from "@repo/db/schema";

import { readString, readUuid } from "../customer/input";
import { fail } from "../organization/errors";

export type ProductType = (typeof productType.enumValues)[number];

export const productTypeLabels = {
  "pull-tab": "揭开卡",
  lottery: "彩票",
  "scratch-card": "刮刮卡",
  "hang-tag": "吊牌",
  "recharge-card": "充值卡",
  "tax-stamp": "税票",
  "user-defined": "自定义",
} as const satisfies Record<ProductType, string>;

const presetTypeNames = new Set<string>(
  productType.enumValues
    .filter((type) => type !== "user-defined")
    .flatMap((type) => [type, productTypeLabels[type]])
);

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
export function readProductType(value: unknown): ProductType {
  const type = productType.enumValues.find((candidate) => candidate === value);
  if (!type) fail(400, "请选择有效的产品类型。");
  return type;
}

function readEnglishName(value: unknown) {
  const name = readString(value, "产品英文名称", 128);
  if ([...name].length < 3) fail(400, "产品英文名称至少需要 3 个字符。");
  return name;
}

function readCustomerDefinedType(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") fail(400, "请填写自定义类型名称。");

  // 自定义类型的首尾空白规则额外包含 U+0085，与数据库约束一致。
  const whitespace = /[\s\u0085]/u;
  let start = 0;
  let end = value.length;
  while (start < end && whitespace.test(value.charAt(start))) start++;
  while (end > start && whitespace.test(value.charAt(end - 1))) end--;
  const name = readString(value.slice(start, end), "自定义类型名称", 64);
  if (presetTypeNames.has(name.toLowerCase())) {
    fail(400, "该名称属于预设类型，请直接选择对应的产品类型。");
  }
  return name;
}

function readCurrencyCode(value: unknown) {
  const code = readString(value, "币种", 3).toUpperCase();
  if (!currencyCodes.has(code)) fail(400, "请选择有效的 ISO 4217 币种。");
  return code;
}

function readUnitPrice(value: unknown) {
  const text =
    typeof value === "number" || typeof value === "string"
      ? String(value).trim()
      : "";
  const parts = /^(\d+)(?:\.(\d{1,4}))?$/u.exec(text);
  if (!parts?.[1]) fail(400, "请输入有效的单价，最多保留 4 位小数。");
  const price = Number(text);
  if (price <= 0 || price > 100_000) {
    fail(400, "产品单价必须大于 0 且不超过 100000。");
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
    fail(400, "揭开口数量须为有效的正整数。");
  }
  return value;
}

function readRemark(value: unknown) {
  if (typeof value !== "string") fail(400, "产品备注须为文本。");
  const remark = value.trim();
  if (remark.length > 4096 || remark.includes("\0")) {
    fail(400, "请检查产品备注，最多可填写 4096 个字符。");
  }
  return remark;
}

const productFieldReaders = {
  name: (value: unknown) => readString(value, "产品名称", 128),
  englishName: readEnglishName,
  productType: readProductType,
  customerDefinedType: readCustomerDefinedType,
  specification: (value: unknown) => readString(value, "产品规格", 128),
  packagingSpecification: (value: unknown) =>
    readString(value, "包装规格", 128),
  colorCount: (value: unknown) => readString(value, "色数", 32),
  paperType: (value: unknown) => readString(value, "纸张类型", 64),
  finishedSize: (value: unknown) => readString(value, "成品尺寸", 64),
  finalMolding: (value: unknown) => readString(value, "最后成型", 64),
  surfaceTreatment: (value: unknown) => readString(value, "表面处理", 64),
  variableColor: (value: unknown) => readString(value, "可变颜色", 64),
  variationMethod: (value: unknown) => readString(value, "变化方式", 64),
  dieCutDirection: (value: unknown) =>
    value === null ? null : readString(value, "模切方向", 32),
  peelOffQuantity: readPeelOffQuantity,
  scratchOffArea: (value: unknown) =>
    value === null ? null : readString(value, "刮刮区", 64),
  currencyCode: readCurrencyCode,
  unitPrice: readUnitPrice,
  remark: readRemark,
};

export type ProductFields = {
  [Key in keyof typeof productFieldReaders]: ReturnType<
    (typeof productFieldReaders)[Key]
  >;
};

export type ProductCreateInput = ProductFields & { customerId: string };
export type ProductPatch = Partial<ProductFields>;

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

function needsScratchOffArea(type: ProductType) {
  return type === "lottery" || type === "scratch-card";
}

function assertTypeSpecificFields(fields: ProductFields) {
  const {
    productType,
    customerDefinedType,
    dieCutDirection,
    peelOffQuantity,
    scratchOffArea,
  } = fields;
  if ((productType === "user-defined") !== (customerDefinedType !== null)) {
    fail(400, "请选择预设类型，或选择自定义类型并填写名称。");
  }

  if (productType === "pull-tab") {
    if (dieCutDirection === null || peelOffQuantity === null) {
      fail(400, "揭开卡必须填写模切方向和揭开口数量。");
    }
  } else if (dieCutDirection !== null || peelOffQuantity !== null) {
    fail(400, "模切方向和揭开口数量仅适用于揭开卡。");
  }

  if (needsScratchOffArea(productType) !== (scratchOffArea !== null)) {
    fail(400, "刮刮卡和彩票必须填写刮刮区，其他类型须留空。");
  }
}

/** 读取新建产品的完整资料，使用固定字段顺序生成规范化输入。 */
export function readProductCreateInput(
  body: Record<string, unknown>
): ProductCreateInput {
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
  assertTypeSpecificFields(fields);
  return { customerId: readUuid(body.customerId, "客户 ID"), ...fields };
}

/** 解析 PATCH 提供的字段，与锁定的产品资料合并后再校验字段间依赖。 */
export function readProductPatch(body: Record<string, unknown>): ProductPatch {
  const fields = productWriteFields.filter((field) =>
    Object.hasOwn(body, field)
  );
  if (!fields.length) fail(400, "请提交需要更新的产品资料。");
  return readProductFields(body, fields);
}

/** 切换类型时清空已失效且未显式提交的字段，返回实际需要写入的资料。 */
export function resolveProductPatch(
  current: ProductFields,
  patch: ProductPatch
): ProductPatch {
  const nextType = patch.productType ?? current.productType;
  const resolved = { ...patch };

  if (
    current.productType === "user-defined" &&
    nextType !== "user-defined" &&
    patch.customerDefinedType === undefined
  ) {
    resolved.customerDefinedType = null;
  }
  if (current.productType === "pull-tab" && nextType !== "pull-tab") {
    if (patch.dieCutDirection === undefined) resolved.dieCutDirection = null;
    if (patch.peelOffQuantity === undefined) resolved.peelOffQuantity = null;
  }
  if (
    needsScratchOffArea(current.productType) &&
    !needsScratchOffArea(nextType) &&
    patch.scratchOffArea === undefined
  ) {
    resolved.scratchOffArea = null;
  }

  assertTypeSpecificFields({ ...current, ...resolved });
  return resolved;
}
