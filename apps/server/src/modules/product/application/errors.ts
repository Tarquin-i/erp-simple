import { BusinessError } from "../../shared/application-error";
import type { validateProductTypeFields } from "../domain/type-fields";

type InvalidProductTypeFields = NonNullable<
  ReturnType<typeof validateProductTypeFields>
>;

const productTypeFieldMessages: Record<InvalidProductTypeFields, string> = {
  productTypeRequiresCustomName: "请选择预设类型，或选择自定义类型并填写名称。",
  pullTabFieldsRequired: "揭开卡必须填写模切方向和揭开口数量。",
  pullTabFieldsForbidden: "模切方向和揭开口数量仅适用于揭开卡。",
  scratchOffAreaMismatch: "刮刮卡和彩票必须填写刮刮区，其他类型须留空。",
};

export function failInvalidProductTypeFields(
  reason: InvalidProductTypeFields
): never {
  throw new BusinessError(
    "product",
    "invalid-type-fields",
    productTypeFieldMessages[reason]
  );
}

const productErrorMessages = {
  "not-found": "产品不存在。",
  "name-conflict": "该客户已有同类型、同产品名的有效产品。",
  "english-name-conflict": "该客户已有同类型、同英文名的有效产品。",
  "idempotency-conflict": "该提交 ID 已用于不同的产品资料。",
  "payout-conflict": "请先归档该产品的有效 Payout。",
  "number-conflict": "产品编号生成冲突，请重试。",
  "concurrent-update": "产品有并发更新，请重试。",
  "version-conflict": "资料已被更新，请查看最新资料后确认是否覆盖。",
} as const;

export type ProductErrorReason =
  | keyof typeof productErrorMessages
  | "invalid-type-fields";

export function failProduct(
  reason: keyof typeof productErrorMessages,
  current?: unknown
): never {
  throw new BusinessError(
    "product",
    reason,
    productErrorMessages[reason],
    current
  );
}
