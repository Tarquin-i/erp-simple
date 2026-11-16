import type { CustomerContactMethodType } from "@/request/customers";

const mainlandMobilePattern = /^(?:\+86[ -]?)?1[3-9]\d{9}$/;
const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * 检查拟提交的联系方式内容，用于表单和覆盖确认。
 * @param type 保存后的联系方式类型。
 * @param value 保存后的联系信息。
 * @returns 校验不通过时返回提示，通过时返回 `undefined`。
 */
export function contactValueError(
  type: CustomerContactMethodType,
  value: string
) {
  const text = value.trim();
  if (!text || text.length > 320 || text.includes("\0"))
    return "请检查联系信息，长度应在 1 至 320 个字符之间。";
  if (
    (type === "phone" || type === "whatsapp") &&
    !mainlandMobilePattern.test(text)
  )
    return "请输入有效的中国大陆手机号码。";
  if (type === "email" && !emailPattern.test(text))
    return "请输入有效的邮箱地址。";
}
