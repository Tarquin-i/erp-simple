import { createHash } from "node:crypto";
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
  current: ReturnType<typeof addressView> | null
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
 * @param addressId 地址 ID。
 * @param expectedVersion 用户读取到的地址版本。
 * @param operation 归档操作可读取同一版本已归档的结果。
 * @returns 已锁定的地址和所属客户。
 * @throws 地址不存在、不可见或已归档且不匹配原版本时返回 404。有效地址版本过期时返回 409。
 */
async function lockAddressForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  addressId: string,
  expectedVersion: number,
  operation: "update" | "archive"
) {
  const activeOnly =
    operation === "update" ? eq(customerAddress.status, "active") : undefined;
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
  if (!target) fail(404, "地址不存在。");

  // 先锁部门和客户，再锁地址。属于同一客户的默认地址写入依次执行。
  const { record } = await lockCustomerForWrite(
    tx,
    access,
    target.customerId,
    "no key update",
    operation === "archive"
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
    fail(404, "地址不存在。");
  }
  if (address.status === "archived") {
    if (address.version !== expectedVersion + 1) fail(404, "地址不存在。");
  } else if (address.version !== expectedVersion) {
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
 * @param expectedDefault 用户确认过的默认地址 ID 和版本。省略表示首次提交，null 表示确认当前没有默认地址。
 * @param requestId 同一次新建在断线重试时复用的提交 UUID。
 * @returns 新建地址，或以当前权限重新读取已保存的地址。
 * @throws 客户或地址不可见时返回 404。重用提交 ID 提交不同资料，或默认地址尚未确认或已变更时返回 409。
 */
export function createAddress(
  access: BusinessAccess,
  customerId: string,
  input: AddressCreateInput,
  expectedDefault: { id: string; version: number } | null | undefined,
  requestId: string
) {
  // 确认替换默认地址前后属于同一次新建。只对地址资料计算指纹。
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ customerId, ...input }))
    .digest("hex");
  return withAddressWrite(async (tx) => {
    const lockKey = JSON.stringify([
      "address-create",
      access.userId,
      requestId,
    ]);
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
          eq(customerAddress.creationActorUserId, access.userId),
          eq(customerAddress.creationRequestId, requestId)
        )
      );
    const { record } = await lockCustomerForWrite(
      tx,
      access,
      existing?.customerId ?? customerId
    );
    if (existing) {
      const [saved] = await tx
        .select()
        .from(customerAddress)
        .where(
          and(activeAddresses(record.id), eq(customerAddress.id, existing.id))
        );
      if (!saved) fail(404, "地址不存在。");
      if (saved.creationRequestHash !== requestHash) {
        throw new HTTPException(409, {
          res: Response.json(
            {
              code: "idempotency_conflict",
              message: "该提交 ID 已用于不同的地址资料。",
            },
            { status: 409 }
          ),
        });
      }
      return addressView(saved, record);
    }

    const [currentDefault] = await tx
      .select()
      .from(customerAddress)
      .where(
        and(activeAddresses(customerId), eq(customerAddress.isDefault, true))
      );
    const defaultNeedsConfirmation = currentDefault
      ? expectedDefault?.id !== currentDefault.id ||
        expectedDefault?.version !== currentDefault.version
      : expectedDefault != null;
    if (input.isDefault && defaultNeedsConfirmation) {
      defaultConflict(
        "existing_default_conflict",
        expectedDefault === undefined
          ? "该客户已有默认地址，请确认是否替换。"
          : "默认地址已变更，请查看最新状态并重新确认。",
        currentDefault ? addressView(currentDefault, record) : null
      );
    }
    if (input.isDefault && currentDefault) {
      await clearDefaultAddress(tx, customerId);
    }

    const [created] = await tx
      .insert(customerAddress)
      .values({
        ...input,
        customerId,
        isDefault: input.isDefault || !currentDefault,
        creationActorUserId: access.userId,
        creationRequestId: requestId,
        creationRequestHash: requestHash,
      })
      .returning();
    return addressView(created, record);
  });
}

/**
 * 编辑地址资料或把它设为默认，客户归属保持为当前记录的客户。
 * 变更国家或省州时须提供城市，未提供的区县和邮编会清空。变更国家时也清空未提供的省州。
 * @param access 调用方身份和范围。
 * @param addressId 待编辑的地址 ID。
 * @param input 已校验的部分更新字段。
 * @param expectedVersion 用户读取到的地址版本。
 * @returns 更新后的地址详情。
 * @throws 地址不可见时返回 404。变更国家或省州时缺少城市，或邮编无效时返回 400。
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
      expectedVersion,
      "update"
    );
    if (address.isDefault && input.isDefault === false) {
      defaultConflict(
        "default_unset_forbidden",
        "请先将其他地址设为默认地址。",
        addressView(address, record)
      );
    }
    const countryChanged =
      input.countryCode !== undefined &&
      input.countryCode !== address.countryCode;
    const provinceChanged =
      input.province !== undefined && input.province !== address.province;
    const locationChanged = countryChanged || provinceChanged;
    if (locationChanged && input.city === undefined) {
      fail(
        400,
        countryChanged
          ? "更换国家或地区时，请重新填写城市。"
          : "更换省或州时，请重新填写城市。"
      );
    }
    const nextPostalCode = locationChanged
      ? (input.postalCode ?? null)
      : input.postalCode;
    const postalCode =
      nextPostalCode !== undefined
        ? normalizeAddressPostalCode(
            input.countryCode ?? address.countryCode,
            nextPostalCode
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
        province: countryChanged ? (input.province ?? null) : input.province,
        district: locationChanged ? (input.district ?? null) : input.district,
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
 * @returns 归档后的地址详情。同一原版本重试时返回已归档的结果。
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
      expectedVersion,
      "archive"
    );
    if (address.status === "archived") return addressView(address, record);

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
