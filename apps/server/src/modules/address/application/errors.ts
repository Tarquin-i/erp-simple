import { ModuleError } from "../../shared/application-error";

const addressErrorMessages = {
  addressNotFound: "地址不存在。",
  customerNotFound: "客户不存在。",
  invalidPostalCode: "请输入与所选国家或地区匹配的有效邮政编码。",
  countryChangeRequiresCity: "更换国家或地区时，请重新填写城市。",
  provinceChangeRequiresCity: "更换省或州时，请重新填写城市。",
  defaultChanged: "默认地址已改变，请刷新后重试。",
  concurrentWrite: "地址有并发更新，请重试。",
  idempotencyConflict: "该提交 ID 已用于不同的地址资料。",
  defaultConfirmationRequired: "该客户已有默认地址，请确认是否替换。",
  defaultConfirmationStale: "默认地址已变更，请查看最新状态并重新确认。",
  defaultUnsetForbidden: "请先将其他地址设为默认地址。",
  versionConflict: "资料已被更新，请查看最新资料后确认是否覆盖。",
} as const;

export type AddressErrorReason = keyof typeof addressErrorMessages;

export function createAddressError(
  reason: AddressErrorReason,
  current?: unknown
) {
  return new ModuleError(
    "address",
    reason,
    addressErrorMessages[reason],
    current
  );
}
