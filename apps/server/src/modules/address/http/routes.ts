import {
  DEFAULT_PHONE_COUNTRY,
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";
import { Hono } from "hono";

import type {
  RecordAccessEnv,
  RecordAccessMiddleware,
} from "../../identity/http/record-access-context";

import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import { fail } from "../../../errors";

import { createAddressError } from "../application/errors";
import {
  normalizeCountryCode,
  normalizePostalCode,
} from "../domain/postal-address";
import type { AddressModule } from "../module";
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
function readAddressPatch(body: Record<string, unknown>): AddressPatch {
  const patch = readAddressFields(body);
  if (!Object.keys(patch).length) fail(400, "请提交需要更新的地址资料。");
  return patch;
}

const createFields = [
  ...addressWriteFields,
  "customerId",
  "expectedDefault",
  "replaceExistingDefault",
];
const updateFields = [...addressWriteFields, "expectedVersion"];

function readExpectedDefault(value: unknown) {
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

function readPagination({ page, pageSize }: Record<string, string>) {
  return {
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
  };
}

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
function readOwnerFilter(
  values: string[] | undefined,
  operators: string[] | undefined
) {
  if (operators && operators.length > 1) {
    fail(400, "业务员筛选只接受一个运算符。");
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, "请选择要筛选的业务员。");
    return;
  }
  if (values.length > 100) fail(400, "业务员筛选最多接受 100 项。");
  const distinctValues = [
    ...new Set(values.map((value) => readString(value, "业务员 ID", 128))),
  ];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, "请选择与业务员所选项数量匹配的筛选运算符。");
  }
  return { values: distinctValues, excluded: operator === exclude };
}

export function createAddressRoutes(
  {
    listDefaultAddresses,
    getAddress,
    createAddress,
    updateAddress,
    archiveAddress,
  }: AddressModule["deliveryAddresses"],
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.use("*", requireRecordAccess);

  routes.get("/", async (c) => {
    const query = c.req.query();
    const { ownerUserId, ownerOperator } = c.req.queries();
    const result = await listDefaultAddresses(c.get("recordAccess"), {
      ...readPagination(query),
      search: query.search?.trim()
        ? readString(query.search, "搜索词", 128)
        : undefined,
      owners: readOwnerFilter(ownerUserId, ownerOperator),
    });
    return c.json(result);
  });

  routes.post("/", async (c) => {
    const body = await readObject(c, createFields);
    // 兼容旧请求中的布尔字段，实际替换以确认的默认地址快照为准。
    const { replaceExistingDefault } = body;
    if (
      replaceExistingDefault !== undefined &&
      typeof replaceExistingDefault !== "boolean"
    ) {
      fail(400, "替换默认地址确认须为布尔值。");
    }
    const address = await createAddress(
      c.get("recordAccess"),
      readUuid(body.customerId, "客户 ID"),
      readAddressCreateInput(body),
      readExpectedDefault(body.expectedDefault),
      readUuid(c.req.header("Idempotency-Key"), "提交 ID")
    );
    return c.json({ address }, 201);
  });

  routes.get("/:addressId", async (c) => {
    const address = await getAddress(
      c.get("recordAccess"),
      readUuid(c.req.param("addressId"), "地址 ID")
    );
    return c.json({ address });
  });

  routes.patch("/:addressId", async (c) => {
    const addressId = readUuid(c.req.param("addressId"), "地址 ID");
    const body = await readObject(c, updateFields);
    const address = await updateAddress(
      c.get("recordAccess"),
      addressId,
      readAddressPatch(body),
      readExpectedVersion(body.expectedVersion)
    );
    return c.json({ address });
  });

  routes.delete("/:addressId", async (c) => {
    const addressId = readUuid(c.req.param("addressId"), "地址 ID");
    const version = c.req.query("expectedVersion");
    const address = await archiveAddress(
      c.get("recordAccess"),
      addressId,
      readExpectedVersion(
        version && /^\d+$/u.test(version) ? Number(version) : undefined
      )
    );
    return c.json({ address });
  });

  return routes;
}

/** 挂到客户路由下，沿用客户路由的业务权限中间件。 */
export function createCustomerAddressRoutes(
  listCustomerAddresses: AddressModule["deliveryAddresses"]["listCustomerAddresses"]
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/:customerId/addresses", async (c) => {
    const result = await listCustomerAddresses(
      c.get("recordAccess"),
      readUuid(c.req.param("customerId"), "客户 ID"),
      readPagination(c.req.query())
    );
    return c.json(result);
  });

  return routes;
}
