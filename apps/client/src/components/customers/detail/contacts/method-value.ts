import {
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";
import type { CountryCode } from "@repo/phone";

import type {
  CustomerContactMethodInput,
  CustomerContactMethodType,
} from "@/request/customers";

import { contactMethodLabels } from "./method-labels";

const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function isPhoneMethod(type: CustomerContactMethodType | "") {
  return type === "phone" || type === "whatsapp";
}

type MethodValue = Pick<CustomerContactMethodInput, "type" | "value">;

export function contactMethodDuplicateError(
  method: MethodValue,
  others: readonly MethodValue[]
) {
  const email = method.type === "email";
  const normalized = method.value.trim().toLowerCase();
  const hasDuplicate = others.some(
    (other) =>
      other.type === method.type &&
      (!email || other.value.trim().toLowerCase() === normalized)
  );
  if (hasDuplicate)
    return email
      ? "该联系人已有此邮箱地址。"
      : `该联系人已有${contactMethodLabels[method.type]}，请选择其他联系方式。`;
}

/**
 * 比较联系信息，旧大陆号码和带国际区号的同一号码视为相等。
 * @param type 两个值共同的联系方式类型。
 * @param first 待比较的联系信息。
 * @param second 对比基准，未提供时视为不同。
 * @returns 两个值是否表示同一个联系信息。
 */
export function sameContactValue(
  type: CustomerContactMethodType | "",
  first: string,
  second?: string
) {
  if (second === undefined) return false;
  if (first.trim() === second.trim()) return true;
  if (!isPhoneMethod(type)) return false;

  const phone = normalizeMobilePhone(first);
  return phone !== undefined && phone === normalizeMobilePhone(second);
}

/**
 * 检查拟提交的联系方式内容，用于表单和覆盖确认。
 * @param type 保存后的联系方式类型。
 * @param value 保存后的联系信息。
 * @param defaultCountry 手机号没有国际区号时使用的国家或地区。
 * @returns 校验不通过时返回提示，通过时返回 `undefined`。
 */
export function contactValueError(
  type: CustomerContactMethodType,
  value: string,
  defaultCountry?: CountryCode
) {
  const text = value.trim();
  if (!text || text.length > 320 || text.includes("\0"))
    return "请检查联系信息，长度应在 1 至 320 个字符之间。";
  if (isPhoneMethod(type) && !normalizeMobilePhone(text, defaultCountry))
    return INVALID_MOBILE_PHONE_MESSAGE;
  if (type === "email" && !emailPattern.test(text))
    return "请输入有效的邮箱地址。";
}
