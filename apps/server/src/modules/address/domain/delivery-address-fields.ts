import {
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "../../shared/phone-number";
import { validateRequiredText } from "../../shared/required-text";
import { normalizeCountryCode, normalizePostalCode } from "./postal-address";

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

export class InvalidDeliveryAddressFields extends Error {
  constructor(
    message: string,
    readonly reason?: "invalidPostalCode"
  ) {
    super(message);
  }
}

function readRequiredText(value: unknown, label: string, max: number) {
  const text = validateRequiredText(value, label, max);
  if (!text.ok) throw new InvalidDeliveryAddressFields(text.message);
  return text.value;
}

function readText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") {
    throw new InvalidDeliveryAddressFields(`${label}须为文本。`);
  }
  const text = value.trim();
  if (text.length > max || text.includes("\0")) {
    throw new InvalidDeliveryAddressFields(
      `请检查${label}，最多可填写 ${max} 个字符。`
    );
  }
  return text;
}

function readNullableText(value: unknown, label: string, max: number) {
  return value === null ? null : readText(value, label, max) || null;
}

function readCountryCode(value: unknown) {
  const code = readRequiredText(value, "国家或地区", 2);
  const normalized = normalizeCountryCode(code);
  if (normalized === undefined) {
    throw new InvalidDeliveryAddressFields("请选择支持的国家或地区。");
  }
  return normalized;
}

function readPhone(value: unknown) {
  const phone = readRequiredText(value, "联系电话", 64);
  const phoneNormalized = normalizeMobilePhone(phone);
  if (!phoneNormalized) {
    throw new InvalidDeliveryAddressFields(INVALID_MOBILE_PHONE_MESSAGE);
  }
  return { phone, phoneNormalized };
}

function normalizeAddressPostalCode(
  countryCode: string,
  postalCode: string | null
) {
  if (postalCode === null) return null;
  const formatted = normalizePostalCode(countryCode, postalCode);
  if (formatted === undefined) {
    throw new InvalidDeliveryAddressFields(
      "请输入与所选国家或地区匹配的有效邮政编码。",
      "invalidPostalCode"
    );
  }
  return formatted;
}

/** 编辑时只处理提供的字段，邮编等合并现有地址后再校验。 */
export function prepareDeliveryAddressFields(
  fields: Record<string, unknown>
): AddressPatch {
  const input: AddressPatch = {};
  if (fields.recipientName !== undefined) {
    input.recipientName = readRequiredText(fields.recipientName, "收货人", 128);
  }
  if (fields.phone !== undefined) Object.assign(input, readPhone(fields.phone));
  if (fields.countryCode !== undefined) {
    input.countryCode = readCountryCode(fields.countryCode);
  }
  if (fields.province !== undefined) {
    input.province = readRequiredText(fields.province, "省或州", 128);
  }
  if (fields.city !== undefined) {
    input.city = readRequiredText(fields.city, "城市", 128);
  }
  if (fields.district !== undefined) {
    input.district = readNullableText(fields.district, "区县", 128);
  }
  if (fields.addressLine1 !== undefined) {
    input.addressLine1 = readRequiredText(fields.addressLine1, "详细地址", 256);
  }
  if (fields.addressLine2 !== undefined) {
    input.addressLine2 = readNullableText(fields.addressLine2, "补充地址", 256);
  }
  if (fields.postalCode !== undefined) {
    input.postalCode = readNullableText(fields.postalCode, "邮编", 32);
  }
  if (fields.remark !== undefined) {
    input.remark = readText(fields.remark, "备注", 4096);
  }
  if (fields.isDefault !== undefined) {
    if (typeof fields.isDefault !== "boolean") {
      throw new InvalidDeliveryAddressFields("默认地址须为布尔值。");
    }
    input.isDefault = fields.isDefault;
  }
  return input;
}

/** 准备新建资料，保持字段顺序供已有提交指纹重试。 */
export function prepareDeliveryAddressCreateFields(
  fields: Record<string, unknown>
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
  } = prepareDeliveryAddressFields(fields);
  if (
    !recipientName ||
    !phone ||
    !phoneNormalized ||
    !province ||
    !city ||
    !addressLine1
  ) {
    throw new InvalidDeliveryAddressFields(
      "请填写收货人、联系电话、省或州、城市和详细地址。"
    );
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
