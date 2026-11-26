import { HTTPException } from "hono/http-exception";

const addressErrors = {
  addressNotFound: { status: 404, message: "地址不存在。" },
  customerNotFound: { status: 404, message: "客户不存在。" },
  invalidPostalCode: {
    status: 400,
    message: "请输入与所选国家或地区匹配的有效邮政编码。",
  },
  countryChangeRequiresCity: {
    status: 400,
    message: "更换国家或地区时，请重新填写城市。",
  },
  provinceChangeRequiresCity: {
    status: 400,
    message: "更换省或州时，请重新填写城市。",
  },
  defaultChanged: {
    status: 409,
    message: "默认地址已改变，请刷新后重试。",
  },
  concurrentWrite: {
    status: 409,
    message: "地址有并发更新，请重试。",
  },
  idempotencyConflict: {
    status: 409,
    code: "idempotency_conflict",
    message: "该提交 ID 已用于不同的地址资料。",
  },
  defaultConfirmationRequired: {
    status: 409,
    code: "existing_default_conflict",
    message: "该客户已有默认地址，请确认是否替换。",
  },
  defaultConfirmationStale: {
    status: 409,
    code: "existing_default_conflict",
    message: "默认地址已变更，请查看最新状态并重新确认。",
  },
  defaultUnsetForbidden: {
    status: 409,
    code: "default_unset_forbidden",
    message: "请先将其他地址设为默认地址。",
  },
} as const;

/** 沿用地址接口原有的 JSON 错误响应及 Content-Type。 */
export function createAddressError(
  reason: keyof typeof addressErrors,
  current?: unknown
) {
  const error = addressErrors[reason];
  return new HTTPException(error.status, {
    res: Response.json(
      {
        code: "code" in error ? error.code : undefined,
        message: error.message,
        current,
      },
      { status: error.status }
    ),
  });
}
