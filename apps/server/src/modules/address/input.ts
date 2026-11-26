import {
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";
import { allCountries } from "country-region-data";
import { format, getAllCountries } from "postal-code-checker";

import { readString } from "../../http/request-input";
import { fail } from "../organization/errors";

const postalCountries = new Set(
  getAllCountries().map(({ countryCode }) => countryCode)
);
const supportedCountries = new Map<string, string>(
  allCountries
    .filter(([, code]) => postalCountries.has(code))
    .map(([name, code]) => [code, name])
);

export const addressWriteFields = [
  "recipientName",
  "phone",
  "countryCode",
  "province",
  "city",
  "district",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "remark",
  "isDefault",
] as const;

export type AddressCreateInput = {
  recipientName: string;
  phone: string;
  phoneNormalized: string;
  countryCode: string;
  province: string;
  city: string;
  district: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  remark: string;
  isDefault: boolean;
};

export type AddressPatch = Partial<AddressCreateInput>;

function readText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") fail(400, `${label}须为文本。`);
  const text = value.trim();
  if (text.length > max || text.includes("\0")) {
    fail(400, `请检查${label}，最多可填写 ${max} 个字符。`);
  }
  return text;
}

function readNullableText(value: unknown, label: string, max: number) {
  return value === null ? null : readText(value, label, max) || null;
}

function readCountryCode(value: unknown) {
  const code = readString(value, "国家或地区", 2);
  const normalized = code.toUpperCase();
  if (!/^[A-Za-z]{2}$/u.test(code) || !supportedCountries.has(normalized)) {
    fail(400, "请选择支持的国家或地区。");
  }
  return normalized;
}

function readPhone(value: unknown) {
  const phone = readString(value, "联系电话", 64);
  const phoneNormalized = normalizeMobilePhone(phone);
  if (!phoneNormalized) fail(400, INVALID_MOBILE_PHONE_MESSAGE);
  return { phone, phoneNormalized };
}

/**
 * 获取地址国际代码对应的国家或地区名称，用于拼接展示地址。
 * @param countryCode 已校验的双字母代码。
 * @returns 数据源中的名称，未收录时返回 undefined。
 */
export function getAddressCountryName(countryCode: string) {
  return supportedCountries.get(countryCode);
}

/**
 * 按国家或地区规范化已填写的邮编，保留前导零和字母。
 * @param countryCode 已校验的国家或地区代码。
 * @param postalCode 已去除首尾空白的邮编，未填写时为 null。
 * @returns 规范化后的邮编，未填写时返回 null。
 * @throws 邮编不符合所在国家或地区的规则时抛出 HTTP 400。
 */
export function normalizeAddressPostalCode(
  countryCode: string,
  postalCode: string | null
) {
  if (postalCode === null) return null;
  const formatted = format(countryCode, postalCode);
  if (!formatted || formatted.length > 32) {
    fail(400, "请输入与所选国家或地区匹配的有效邮政编码。");
  }
  return formatted;
}

function readAddressFields(body: Record<string, unknown>): AddressPatch {
  const input: AddressPatch = {};
  if (body.recipientName !== undefined) {
    input.recipientName = readString(body.recipientName, "收货人", 128);
  }
  if (body.phone !== undefined) Object.assign(input, readPhone(body.phone));
  if (body.countryCode !== undefined) {
    input.countryCode = readCountryCode(body.countryCode);
  }
  if (body.province !== undefined) {
    input.province = readString(body.province, "省或州", 128);
  }
  if (body.city !== undefined) input.city = readString(body.city, "城市", 128);
  if (body.district !== undefined) {
    input.district = readNullableText(body.district, "区县", 128);
  }
  if (body.addressLine1 !== undefined) {
    input.addressLine1 = readString(body.addressLine1, "详细地址", 256);
  }
  if (body.addressLine2 !== undefined) {
    input.addressLine2 = readNullableText(body.addressLine2, "补充地址", 256);
  }
  if (body.postalCode !== undefined) {
    input.postalCode = readNullableText(body.postalCode, "邮编", 32);
  }
  if (body.remark !== undefined)
    input.remark = readText(body.remark, "备注", 4096);
  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== "boolean") fail(400, "默认地址须为布尔值。");
    input.isDefault = body.isDefault;
  }
  return input;
}

/**
 * 解析完整的新建地址资料，补齐默认值并规范化电话和邮编。
 * @param body 已经校验 JSON 结构及白名单的请求体。
 * @returns 可以保存的地址资料。
 * @throws 必填数据缺失、格式或长度无效时抛出 HTTP 400。
 */
export function readAddressCreateInput(
  body: Record<string, unknown>
): AddressCreateInput {
  const {
    recipientName,
    phone,
    phoneNormalized,
    countryCode = DEFAULT_PHONE_COUNTRY,
    province,
    city,
    district = null,
    addressLine1,
    addressLine2 = null,
    postalCode = null,
    remark = "",
    isDefault = false,
  } = readAddressFields(body);
  if (
    !recipientName ||
    !phone ||
    !phoneNormalized ||
    !province ||
    !city ||
    !addressLine1
  ) {
    fail(400, "请填写收货人、联系电话、省或州、城市和详细地址。");
  }
  return {
    recipientName,
    phone,
    phoneNormalized,
    countryCode,
    province,
    city,
    district,
    addressLine1,
    addressLine2,
    postalCode: normalizeAddressPostalCode(countryCode, postalCode),
    remark,
    isDefault,
  };
}

/**
 * 解析本次编辑指定的字段，邮编在与当前地址合并后校验。
 * @param body 已经校验 JSON 结构及白名单的请求体。
 * @returns 规范化后的部分地址资料，未指定的字段不返回。
 * @throws 缺少变更字段或字段格式不符时抛出 HTTP 400。
 */
export function readAddressPatch(body: Record<string, unknown>): AddressPatch {
  const patch = readAddressFields(body);
  if (!Object.keys(patch).length) fail(400, "请提交需要更新的地址资料。");
  return patch;
}
