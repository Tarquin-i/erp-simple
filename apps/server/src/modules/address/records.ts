import { customer, customerAddress } from "@repo/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { businessScopeWhere } from "../business/access";
import type { BusinessAccess } from "../business/access";
import { failVersionConflict, isConstraintError } from "../customer/input";
import { lockCustomerForWrite } from "../customer/records";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";

import { normalizeAddressPostalCode } from "./input";
import type { AddressCreateInput, AddressPatch } from "./input";
import { addressView } from "./queries";

const defaultConstraint = "customer_address_customer_default_unique";

function activeAddresses(customerId: string) {
  return and(
    eq(customerAddress.customerId, customerId),
    eq(customerAddress.status, "active")
  );
}

function defaultConflict(
  code: "existing_default_conflict" | "default_unset_forbidden",
  message: string,
  current: ReturnType<typeof addressView>
): never {
  throw new HTTPException(409, {
    res: Response.json({ code, message, current }, { status: 409 }),
  });
}

/**
 * 运行地址写入事务，遇到 PostgreSQL 死锁时有限次重试整个操作。
 * @param run 一次事务中的数据库操作。
 * @returns 已提交操作的结果。
 * @throws 业务错误原样返回，重试用尽或默认约束冲突时返回 409。
 */
async function withAddressWrite<T>(
  run: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(run);
    } catch (error) {
      if (isConstraintError(error, "23505", defaultConstraint)) {
        fail(409, "默认地址已改变，请刷新后重试。");
      }
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "40P01"
      ) {
        throw error;
      }
      if (attempt === 3) fail(409, "地址有并发更新，请重试。");
    }
  }
}

/**
 * 在客户锁之后锁住指定地址，检查版本后才允许写入。
 * @param tx 调用方的写事务。
 * @param access 调用方身份和请求初始权限。
 * @param addressId 活跃地址 ID。
 * @param expectedVersion 用户读取到的地址版本。
 * @returns 已锁定的地址和所属客户。
 * @throws 地址不存在、已归档或不可见时返回 404，版本过期时返回 409。
 */
async function lockAddressForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  addressId: string,
  expectedVersion: number
) {
  const [target] = await tx
    .select({ customerId: customerAddress.customerId })
    .from(customerAddress)
    .innerJoin(customer, eq(customerAddress.customerId, customer.id))
    .where(
      and(
        eq(customerAddress.id, addressId),
        eq(customerAddress.status, "active"),
        businessScopeWhere(access, customer)
      )
    );
  if (!target) fail(404, "地址不存在。");

  // 先锁部门和客户，再锁地址。属于同一客户的默认地址写入依次执行。
  const { record } = await lockCustomerForWrite(tx, access, target.customerId);
  const [address] = await tx
    .select()
    .from(customerAddress)
    .where(and(activeAddresses(record.id), eq(customerAddress.id, addressId)))
    .for("update");
  if (!address) fail(404, "地址不存在。");
  if (address.version !== expectedVersion) {
    failVersionConflict(addressView(address, record));
  }
  return { address, record };
}

const revision = {
  version: sql`${customerAddress.version} + 1`,
  updatedAt: sql`clock_timestamp()`,
};

async function clearDefaultAddress(
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

/**
 * 在指定客户下新增地址，第一条自动设为默认。
 * @param access 调用方身份及数据范围。
 * @param customerId 所属客户 ID。
 * @param input 已校验的收货资料和默认标记。
 * @param replaceExistingDefault 用户是否确认替换当前默认地址。
 * @returns 已保存的新地址详情。
 * @throws 客户不可见时返回 404，未确认替换已有默认地址时返回 409。
 */
export function createAddress(
  access: BusinessAccess,
  customerId: string,
  input: AddressCreateInput,
  replaceExistingDefault: boolean
) {
  return withAddressWrite(async (tx) => {
    const { record } = await lockCustomerForWrite(tx, access, customerId);
    const [currentDefault] = await tx
      .select()
      .from(customerAddress)
      .where(
        and(activeAddresses(customerId), eq(customerAddress.isDefault, true))
      );
    if (currentDefault && input.isDefault) {
      if (!replaceExistingDefault) {
        defaultConflict(
          "existing_default_conflict",
          "该客户已有默认地址，请确认是否替换。",
          addressView(currentDefault, record)
        );
      }
      await clearDefaultAddress(tx, customerId);
    }

    const [created] = await tx
      .insert(customerAddress)
      .values({
        ...input,
        customerId,
        isDefault: input.isDefault || !currentDefault,
      })
      .returning();
    return addressView(created, record);
  });
}

/**
 * 编辑地址资料或把它设为默认，客户归属保持为当前记录的客户。
 * 变更省或州时须提供城市，未提供的区县和邮编会清空。
 * @param access 调用方身份和范围。
 * @param addressId 待编辑的地址 ID。
 * @param input 已校验的部分更新字段。
 * @param expectedVersion 用户读取到的地址版本。
 * @returns 更新后的地址详情。
 * @throws 地址不可见时返回 404。变更省或州时缺少城市，或邮编无效时返回 400。
 * 版本过期或直接取消默认时返回 409。
 */
export function updateAddress(
  access: BusinessAccess,
  addressId: string,
  input: AddressPatch,
  expectedVersion: number
) {
  return withAddressWrite(async (tx) => {
    const { address, record } = await lockAddressForWrite(
      tx,
      access,
      addressId,
      expectedVersion
    );
    if (address.isDefault && input.isDefault === false) {
      defaultConflict(
        "default_unset_forbidden",
        "请先将其他地址设为默认地址。",
        addressView(address, record)
      );
    }
    const provinceChanged =
      input.province !== undefined && input.province !== address.province;
    if (provinceChanged && input.city === undefined) {
      fail(400, "更换省或州时，请重新填写城市。");
    }
    const nextPostalCode = provinceChanged
      ? (input.postalCode ?? null)
      : input.postalCode;
    const postalCode =
      input.countryCode !== undefined || nextPostalCode !== undefined
        ? normalizeAddressPostalCode(
            input.countryCode ?? address.countryCode,
            nextPostalCode === undefined ? address.postalCode : nextPostalCode
          )
        : undefined;
    if (input.isDefault && !address.isDefault) {
      // 部分唯一索引立即生效，旧默认必须先取消。
      await clearDefaultAddress(tx, record.id);
    }
    const [updated] = await tx
      .update(customerAddress)
      .set({
        ...input,
        ...revision,
        district: provinceChanged ? (input.district ?? null) : input.district,
        postalCode,
      })
      .where(eq(customerAddress.id, addressId))
      .returning();
    return addressView(updated, record);
  });
}

/**
 * 归档有效地址，归档默认时从剩余地址中选最近更新的一条递补。
 * @param access 调用方身份和范围。
 * @param addressId 待归档的地址 ID。
 * @param expectedVersion 用户读取到的地址版本。
 * @returns 归档后的地址详情。
 * @throws 地址不可见时返回 404，版本过期时返回 409。
 */
export function archiveAddress(
  access: BusinessAccess,
  addressId: string,
  expectedVersion: number
) {
  return withAddressWrite(async (tx) => {
    const { address, record } = await lockAddressForWrite(
      tx,
      access,
      addressId,
      expectedVersion
    );
    const [archived] = await tx
      .update(customerAddress)
      .set({ ...revision, isDefault: false, status: "archived" })
      .where(eq(customerAddress.id, addressId))
      .returning();
    if (address.isDefault) {
      const [replacement] = await tx
        .select({ id: customerAddress.id })
        .from(customerAddress)
        .where(activeAddresses(record.id))
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
    return addressView(archived, record);
  });
}
