import type { DatabaseTransaction } from "@repo/db";
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

import { businessScopeWhere } from "../../business/access";
import type { BusinessAccess } from "../../business/access";
import type { ListOptionFilter } from "../../business/list-option-filter";
import { lockCustomerForWrite } from "../../customer";

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

export type Address = typeof customerAddress.$inferSelect;
export type AddressPagination = {
  page: number;
  pageSize: number;
  search?: string;
};
export type AddressDirectoryQuery = AddressPagination & {
  owners?: ListOptionFilter;
};

const customerFields = {
  id: customer.id,
  customerNo: customer.customerNo,
  companyName: customer.companyName,
};

export type AddressCustomer = Pick<
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

/**
 * 使用同一组可见范围和搜索条件读取一页地址及总数。
 * @param tx 持有一致读快照的事务。
 * @param access 事务内重新读取的业务权限。
 * @param pagination 分页、可选搜索词和所属客户的业务员筛选。
 * @param customerId 指定时读取该客户的全部有效地址，省略时读取各客户默认地址。
 * @returns 一页地址记录及总数。
 */
export async function selectAddressPage(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  { page, pageSize, search, owners }: AddressDirectoryQuery,
  customerId?: string
) {
  const ownerMatches = owners?.excluded ? notInArray : inArray;
  const filter = and(
    businessScopeWhere(access, customer),
    eq(customer.status, "active"),
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

  return { rows, total: total.count, page, pageSize };
}

export async function findAddressCustomer(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  customerId: string
) {
  const [owner] = await tx
    .select(customerFields)
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.status, "active"),
        businessScopeWhere(access, customer)
      )
    );
  return owner;
}

export async function findAddress(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  addressId: string
) {
  const [record] = await tx
    .select({ address: customerAddress, customer: customerFields })
    .from(customerAddress)
    .innerJoin(customer, eq(customerAddress.customerId, customer.id))
    .where(
      and(
        eq(customerAddress.id, addressId),
        eq(customerAddress.status, "active"),
        eq(customer.status, "active"),
        businessScopeWhere(access, customer)
      )
    );
  return record;
}

const revision = {
  version: sql`${customerAddress.version} + 1`,
  updatedAt: sql`clock_timestamp()`,
};

function activeAddresses(customerId: string) {
  return and(
    eq(customerAddress.customerId, customerId),
    eq(customerAddress.status, "active")
  );
}

/** 同一账号、提交 ID 的新建请求在当前事务内串行执行。 */
export async function lockAddressCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  const lockKey = JSON.stringify(["address-create", userId, requestId]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  );
  const [existing] = await tx
    .select({
      id: customerAddress.id,
      customerId: customerAddress.customerId,
    })
    .from(customerAddress)
    .where(
      and(
        eq(customerAddress.creationActorUserId, userId),
        eq(customerAddress.creationRequestId, requestId)
      )
    );
  return existing;
}

/** 先通过客户模块加锁并复核权限，再锁地址行。 */
export async function lockAddressForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  addressId: string,
  includeArchived: boolean
) {
  const activeOnly = includeArchived
    ? undefined
    : eq(customerAddress.status, "active");
  const [target] = await tx
    .select({ customerId: customerAddress.customerId })
    .from(customerAddress)
    .innerJoin(customer, eq(customerAddress.customerId, customer.id))
    .where(
      and(
        eq(customerAddress.id, addressId),
        activeOnly,
        businessScopeWhere(access, customer)
      )
    );
  if (!target) return;

  // 同一客户的地址写入与客户归档共用客户行锁。
  const { record } = await lockCustomerForWrite(
    tx,
    access,
    target.customerId,
    "no key update",
    includeArchived
  );
  const [address] = await tx
    .select()
    .from(customerAddress)
    .where(
      and(
        eq(customerAddress.customerId, record.id),
        eq(customerAddress.id, addressId),
        activeOnly
      )
    )
    .for("update");
  if (
    !address ||
    (record.status === "archived" && address.status === "active")
  ) {
    return;
  }
  return { address, record };
}

export async function findSavedAddress(
  tx: DatabaseTransaction,
  customerId: string,
  addressId: string
) {
  const [saved] = await tx
    .select()
    .from(customerAddress)
    .where(and(activeAddresses(customerId), eq(customerAddress.id, addressId)));
  return saved;
}

export async function findDefaultAddress(
  tx: DatabaseTransaction,
  customerId: string
) {
  const [address] = await tx
    .select()
    .from(customerAddress)
    .where(
      and(activeAddresses(customerId), eq(customerAddress.isDefault, true))
    );
  return address;
}

export async function clearDefaultAddress(
  tx: DatabaseTransaction,
  customerId: string
) {
  await tx
    .update(customerAddress)
    .set({ ...revision, isDefault: false })
    .where(
      and(activeAddresses(customerId), eq(customerAddress.isDefault, true))
    );
}

export async function insertAddress(
  tx: DatabaseTransaction,
  customerId: string,
  input: AddressCreateInput,
  request: { userId: string; id: string; hash: string }
) {
  const [created] = await tx
    .insert(customerAddress)
    .values({
      ...input,
      customerId,
      creationActorUserId: request.userId,
      creationRequestId: request.id,
      creationRequestHash: request.hash,
    })
    .returning();
  return created;
}

export async function updateAddressRecord(
  tx: DatabaseTransaction,
  addressId: string,
  patch: Omit<AddressPatch, "province"> & { province?: string | null }
) {
  const [updated] = await tx
    .update(customerAddress)
    .set({ ...patch, ...revision })
    .where(eq(customerAddress.id, addressId))
    .returning();
  return updated;
}

export async function archiveAddressRecord(
  tx: DatabaseTransaction,
  addressId: string
) {
  const [archived] = await tx
    .update(customerAddress)
    .set({ ...revision, isDefault: false, status: "archived" })
    .where(eq(customerAddress.id, addressId))
    .returning();
  return archived;
}

/** 在当前写入事务内选择并锁定最近更新的有效地址。 */
export async function promoteNextAddress(
  tx: DatabaseTransaction,
  customerId: string
) {
  const [replacement] = await tx
    .select({ id: customerAddress.id })
    .from(customerAddress)
    .where(activeAddresses(customerId))
    .orderBy(desc(customerAddress.updatedAt), desc(customerAddress.id))
    .limit(1)
    .for("update");
  if (replacement) {
    await tx
      .update(customerAddress)
      .set({ ...revision, isDefault: true })
      .where(eq(customerAddress.id, replacement.id));
  }
}
