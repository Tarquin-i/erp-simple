import { ProductApiError, productTypeLabels } from "@/request/products";
import type {
  ProductDetailRecord,
  ProductWriteInput,
} from "@/request/products";

import { productFieldLabels } from "./form";

export type ProductFormIssue = {
  error: string;
  fieldError?: "name" | "englishName";
};

export function productFormIssue(failure: unknown): ProductFormIssue {
  if (!(failure instanceof ProductApiError)) {
    return { error: "暂时无法确认保存结果，请重试。" };
  }
  const fieldError =
    failure.code === "product_name_conflict"
      ? "name"
      : failure.code === "product_english_name_conflict"
        ? "englishName"
        : undefined;
  return { error: failure.message, fieldError };
}

type ProductField = keyof ProductWriteInput;
const productFields = Object.keys(productFieldLabels) as ProductField[];
const typeSpecificFields = [
  "customerDefinedType",
  "dieCutDirection",
  "peelOffQuantity",
  "scratchOffArea",
] as const;

function differentFields(base: ProductWriteInput, proposed: ProductWriteInput) {
  return productFields.filter((field) =>
    field === "unitPrice"
      ? Number(base.unitPrice) !== Number(proposed.unitPrice)
      : base[field] !== proposed[field]
  );
}

export function productChanges(
  base: ProductWriteInput,
  proposed: ProductWriteInput
) {
  const fields = new Set(differentFields(base, proposed));
  if (fields.has("productType")) {
    for (const field of typeSpecificFields) fields.add(field);
  }
  return Object.fromEntries(
    [...fields].map((field) => [field, proposed[field]])
  ) as Partial<ProductWriteInput>;
}

/** 保留本次修改，远端类型变更时一并展示专用字段依赖的类型差异。 */
export function rebaseProductEdit(
  current: ProductDetailRecord,
  patch: Partial<ProductWriteInput>,
  proposed: ProductWriteInput
) {
  const merged = { ...current, ...patch };
  if (
    current.productType !== proposed.productType &&
    typeSpecificFields.some(
      (field) => patch[field] != null && current[field] === null
    )
  ) {
    return {
      ...merged,
      productType: proposed.productType,
      customerDefinedType: proposed.customerDefinedType,
      dieCutDirection: proposed.dieCutDirection,
      peelOffQuantity: proposed.peelOffQuantity,
      scratchOffArea: proposed.scratchOffArea,
    };
  }
  return merged;
}

function displayField(product: ProductWriteInput, field: ProductField) {
  if (field === "productType") return productTypeLabels[product.productType];
  return String(product[field] ?? "");
}

export function productDifferences(
  current: ProductWriteInput,
  proposed: ProductWriteInput
) {
  return differentFields(current, proposed).map((field) => ({
    label: productFieldLabels[field],
    current: displayField(current, field),
    proposed: displayField(proposed, field),
  }));
}
