import { customer, customerAddress } from "@repo/db/schema";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import {
  businessScopeWhere,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import type { ListOptionFilter } from "../business/list-option-filter";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { getAddressCountryName } from "./input";

type Address = typeof customerAddress.$inferSelect;
type AddressPagination = { page: number; pageSize: number; search?: string };
type AddressDirectoryQuery = AddressPagination & { owners?: ListOptionFilter };

const customerFields = {
  id: customer.id,
  customerNo: customer.customerNo,
  companyName: customer.companyName,
};

type AddressCustomer = Pick<
  typeof customer.$inferSelect,
  keyof typeof customerFields
>;

const locationFields = {
  countryCode: customerAddress.countryCode,
  province: customerAddress.province,
  city: customerAddress.city,
  district: customerAddress.district,
  addressLine1: customerAddress.addressLine1,
  addressLine2: customerAddress.addressLine2,
  postalCode: customerAddress.postalCode,
};

const listFields = {
  id: customerAddress.id,
  customerId: customerAddress.customerId,
  recipientName: customerAddress.recipientName,
  phone: customerAddress.phone,
  isDefault: customerAddress.isDefault,
  updatedAt: customerAddress.updatedAt,
  version: customerAddress.version,
};

/** 按中国或国际地址顺序拼接非空地址字段，保留邮编。 */
function formatAddress(address: Pick<Address, keyof typeof locationFields>) {
  const {
    countryCode,
    province,
    city,
    district,
    addressLine1,
    addressLine2,
    postalCode,
  } = address;
  if (countryCode === "CN") {
    const location = [
      "中国",
      province,
      city,
      district,
      addressLine1,
      addressLine2,
    ]
      .filter(Boolean)
      .join("");
    return [location, postalCode].filter(Boolean).join(" ");
  }

  const countryName = getAddressCountryName(countryCode) ?? countryCode;
  return [
    addressLine2,
    addressLine1,
    district,
    city,
    province,
    postalCode,
    countryName,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * 生成地址详情和写入响应共用的展示数据。
 * @param row 数据库地址记录。
 * @param owner 已通过权限校验的所属客户摘要。
 * @returns 地址字段、所属客户摘要和格式化地址。
 */
export function addressView(
  row: Address,
  { id, customerNo, companyName }: AddressCustomer
) {
  const {
    creationActorUserId,
    creationRequestId,
    creationRequestHash,
    ...address
  } = row;
  return {
    ...address,
    customer: { id, customerNo, companyName },
    formattedAddress: formatAddress(address),
  };
}

/**
 * 使用同一组可见范围和搜索条件读取一页地址及总数。
 * @param tx 持有一致读快照的事务。
 * @param access 事务内重新读取的业务权限。
 * @param pagination 分页、可选搜索词和所属客户的业务员筛选。
 * @param customerId 指定时读取该客户的全部有效地址，省略时读取各客户默认地址。
 * @returns 地址摘要列表及分页信息。
 */
async function readAddressPage(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  { page, pageSize, search, owners }: AddressDirectoryQuery,
  customerId?: string
) {
  const ownerMatches = owners?.excluded ? notInArray : inArray;
  const filter = and(
    businessScopeWhere(access, customer),
    eq(customerAddress.status, "active"),
    customerId === undefined
      ? eq(customerAddress.isDefault, true)
      : eq(customerAddress.customerId, customerId),
    owners ? ownerMatches(customer.ownerUserId, owners.values) : undefined,
    search === undefined
      ? undefined
      : or(
          sql`position(lower(${search}::text) in ${customer.normalizedCompanyName}) > 0`,
          sql`position(lower(${search}::text) in lower(${customer.customerNo})) > 0`,
          sql`position(lower(${search}::text) in lower(${customerAddress.recipientName})) > 0`
        )
  );

  const rows = await tx
    .select({
      address: listFields,
      location: locationFields,
      customer: customerFields,
    })
    .from(customerAddress)
    .innerJoin(customer, eq(customerAddress.customerId, customer.id))
    .where(filter)
    .orderBy(
      ...(customerId === undefined ? [] : [desc(customerAddress.isDefault)]),
      desc(customerAddress.updatedAt),
      desc(customerAddress.id)
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await tx
    .select({ count: count() })
    .from(customerAddress)
    .innerJoin(customer, eq(customerAddress.customerId, customer.id))
    .where(filter);

  return {
    addresses: rows.map(({ address, location, customer: owner }) => ({
      ...address,
      customer: owner,
      formattedAddress: formatAddress(location),
    })),
    total: total.count,
    page,
    pageSize,
  };
}

/**
 * 按当前客户可见范围查询各客户的有效默认地址。
 * @param access 调用账号及其初始业务权限。
 * @param query 分页、业务员筛选及可按客户名称、客户编号或收货人匹配的搜索词。
 * @returns 默认地址摘要和分页信息，按更新时间和 ID 倒序。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403。
 */
export function listDefaultAddresses(
  access: BusinessAccess,
  query: AddressDirectoryQuery
) {
  return withBusinessReadSnapshot(access.userId, (tx, currentAccess) =>
    readAddressPage(tx, currentAccess, query)
  );
}

/**
 * 查询指定客户的有效地址，在同一快照中确认客户是否可见。
 * @param access 调用账号及其初始业务权限。
 * @param customerId 地址所属客户 ID。
 * @param pagination 分页与可选搜索词。
 * @returns 客户摘要、默认地址在前的地址列表和分页信息。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403，客户不存在或不可见时抛出 HTTP 404。
 */
export function listCustomerAddresses(
  access: BusinessAccess,
  customerId: string,
  pagination: AddressPagination
) {
  return withBusinessReadSnapshot(access.userId, async (tx, currentAccess) => {
    const [owner] = await tx
      .select(customerFields)
      .from(customer)
      .where(
        and(
          eq(customer.id, customerId),
          businessScopeWhere(currentAccess, customer)
        )
      );
    if (!owner) fail(404, "客户不存在。");

    const result = await readAddressPage(
      tx,
      currentAccess,
      pagination,
      customerId
    );
    return { ...result, customer: owner };
  });
}

/**
 * 读取单条有效地址详情，权限跟随所属客户。
 * @param access 调用账号及其初始业务权限。
 * @param addressId 待查看的地址 ID。
 * @returns 地址详情，包含客户摘要和格式化地址。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403，地址不存在或不可见时抛出 HTTP 404。
 */
export function getAddress(access: BusinessAccess, addressId: string) {
  return withBusinessReadSnapshot(access.userId, async (tx, currentAccess) => {
    const [record] = await tx
      .select({ address: customerAddress, customer: customerFields })
      .from(customerAddress)
      .innerJoin(customer, eq(customerAddress.customerId, customer.id))
      .where(
        and(
          eq(customerAddress.id, addressId),
          eq(customerAddress.status, "active"),
          businessScopeWhere(currentAccess, customer)
        )
      );
    if (!record) fail(404, "地址不存在。");
    return addressView(record.address, record.customer);
  });
}
