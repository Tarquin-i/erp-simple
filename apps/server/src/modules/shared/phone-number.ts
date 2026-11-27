import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { CountryCode } from "libphonenumber-js/max";

export {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";
export type { CountryCode } from "libphonenumber-js/max";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "CN";
export const INVALID_MOBILE_PHONE_MESSAGE = "请输入有效的手机号码。";

/**
 * 校验完整的手机号码并转为 E.164。部分地区的号段无法区分手机和座机。
 * @param value 用户输入的号码，可带国际区号。
 * @param defaultCountry 未填写国际区号时使用的国家或地区，默认中国大陆。
 * @returns 规范号码。号码无效、带分机或明确为非手机类型时返回 undefined。
 */
export function normalizeMobilePhone(
  value: string,
  defaultCountry = DEFAULT_PHONE_COUNTRY
) {
  const phone = parsePhoneNumberFromString(value.trim(), {
    defaultCountry,
    extract: false,
  });
  if (!phone || phone.ext || !phone.isValid()) return undefined;

  const type = phone.getType();
  return type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE"
    ? phone.number
    : undefined;
}
