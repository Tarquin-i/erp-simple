import type { productType } from "@repo/db/schema";

export type ProductType = (typeof productType.enumValues)[number];

export type ProductFields = {
  name: string;
  englishName: string;
  productType: ProductType;
  customerDefinedType: string | null;
  specification: string;
  packagingSpecification: string;
  colorCount: string;
  paperType: string;
  finishedSize: string;
  finalMolding: string;
  surfaceTreatment: string;
  variableColor: string;
  variationMethod: string;
  dieCutDirection: string | null;
  peelOffQuantity: number | null;
  scratchOffArea: string | null;
  currencyCode: string;
  unitPrice: string;
  remark: string;
};

export type ProductCreateInput = ProductFields & { customerId: string };
export type ProductPatch = Partial<ProductFields>;

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
  Object.entries(productTypeLabels)
    .filter(([type]) => type !== "user-defined")
    .flat()
);

export function trimCustomerDefinedType(value: string) {
  // 自定义类型的首尾空白规则额外包含 U+0085，与数据库约束一致。
  const whitespace = /[\s\u0085]/u;
  let start = 0;
  let end = value.length;
  while (start < end && whitespace.test(value.charAt(start))) start++;
  while (end > start && whitespace.test(value.charAt(end - 1))) end--;
  return value.slice(start, end);
}

export function isPresetProductTypeName(name: string) {
  return presetTypeNames.has(name.toLowerCase());
}

function needsScratchOffArea(type: ProductType) {
  return type === "lottery" || type === "scratch-card";
}

type ProductTypeFields = Pick<
  ProductFields,
  | "productType"
  | "customerDefinedType"
  | "dieCutDirection"
  | "peelOffQuantity"
  | "scratchOffArea"
>;

export function validateProductTypeFields({
  productType,
  customerDefinedType,
  dieCutDirection,
  peelOffQuantity,
  scratchOffArea,
}: ProductTypeFields) {
  if ((productType === "user-defined") !== (customerDefinedType !== null)) {
    return "productTypeRequiresCustomName";
  }

  if (productType === "pull-tab") {
    if (dieCutDirection === null || peelOffQuantity === null) {
      return "pullTabFieldsRequired";
    }
  } else if (dieCutDirection !== null || peelOffQuantity !== null) {
    return "pullTabFieldsForbidden";
  }

  if (needsScratchOffArea(productType) !== (scratchOffArea !== null)) {
    return "scratchOffAreaMismatch";
  }
}

/** 切换类型时清空已失效且未显式提交的字段，校验合并后的资料。 */
export function resolveProductPatch(
  current: ProductFields,
  patch: ProductPatch
) {
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

  const reason = validateProductTypeFields({ ...current, ...resolved });
  if (reason) return { ok: false, reason } as const;
  return { ok: true, fields: resolved } as const;
}
