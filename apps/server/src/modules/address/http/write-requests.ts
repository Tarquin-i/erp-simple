import {
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";

import { fail } from "../../../errors";
import {
  readExpectedVersion,
  readString,
  readUuid,
} from "../../../http/request-input";
import { createAddressError } from "../application/errors";
import {
  normalizeCountryCode,
  normalizePostalCode,
} from "../domain/postal-address";
import type {
  AddressCreateInput,
  AddressPatch,
} from "../persistence/delivery-addresses";

const addressWriteFields = [
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
  const normalized = normalizeCountryCode(code);
  if (normalized === undefined) {
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

function normalizeAddressPostalCode(
  countryCode: string,
  postalCode: string | null
) {
  if (postalCode === null) return null;
  const formatted = normalizePostalCode(countryCode, postalCode);
  if (formatted === undefined) throw createAddressError("invalidPostalCode");
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

export const addressCreateFields = [
  ...addressWriteFields,
  "customerId",
  "expectedDefault",
  "replaceExistingDefault",
];
export const addressPatchFields = [...addressWriteFields, "expectedVersion"];

export function readExpectedDefault(value: unknown) {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "id" && key !== "version")
  ) {
    fail(400, "请提交有效的默认地址及版本。");
  }
  const { id, version } = value as Record<string, unknown>;
  return {
    id: readUuid(id, "默认地址 ID"),
    version: readExpectedVersion(version),
  };
}
