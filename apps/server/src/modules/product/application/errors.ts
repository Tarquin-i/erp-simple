import { HTTPException } from "hono/http-exception";

import { fail } from "../../organization/errors";
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
  return fail(400, productTypeFieldMessages[reason]);
}

const productConflictMessages = {
  product_name_conflict: "该客户已有同类型、同产品名的有效产品。",
  product_english_name_conflict: "该客户已有同类型、同英文名的有效产品。",
  idempotency_conflict: "该提交 ID 已用于不同的产品资料。",
  product_payout_conflict: "请先归档该产品的有效 Payout。",
} as const;

export function failProductConflict(
  code: keyof typeof productConflictMessages
): never {
  throw new HTTPException(409, {
    res: Response.json(
      { code, message: productConflictMessages[code] },
      { status: 409 }
    ),
  });
}

export function failProductNotFound(): never {
  return fail(404, "产品不存在。");
}
