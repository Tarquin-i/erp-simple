import { createHash } from "node:crypto";
import { customer, payout, product } from "@repo/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { businessScopeWhere } from "../business/access";
import type { BusinessAccess } from "../business/access";
import { lockCustomerForWrite } from "../customer";
import { failVersionConflict, isConstraintError } from "../customer/input";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";

import { resolveProductPatch } from "./input";
import type { ProductCreateInput, ProductPatch } from "./input";
import { productView } from "./queries";

const nameConstraints = [
  [
    "product_customer_active_name_unique",
    "product_name_conflict",
    "该客户已有同类型、同产品名的有效产品。",
  ],
  [
    "product_customer_active_english_name_unique",
    "product_english_name_conflict",
    "该客户已有同类型、同英文名的有效产品。",
  ],
] as const;

function conflict(code: string, message: string): never {
  throw new HTTPException(409, {
    res: Response.json({ code, message }, { status: 409 }),
  });
}

/** 由唯一索引兜底名称查重，撞编号或死锁时重新执行完整事务。 */
async function writeProduct<T>(write: (tx: DatabaseTransaction) => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(write);
    } catch (error) {
      const nameConflict = nameConstraints.find(([constraint]) =>
        isConstraintError(error, "23505", constraint)
      );
      if (nameConflict) conflict(nameConflict[1], nameConflict[2]);
      if (isConstraintError(error, "23505", "product_product_no_unique")) {
        if (attempt >= 5) fail(409, "产品编号生成冲突，请重试。");
        continue;
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
      if (attempt >= 3) fail(409, "产品有并发更新，请重试。");
    }
  }
}

function activeProduct(id: string, customerId: string) {
  return and(
    eq(product.id, id),
    eq(product.customerId, customerId),
    eq(product.status, "active")
  );
}

const revision = {
  version: sql`${product.version} + 1`,
  updatedAt: sql`clock_timestamp()`,
};

/** 先锁客户并重新确认可访问范围，再锁产品并核对版本。 */
async function lockProductForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  expectedVersion: number,
  operation: "update" | "archive"
) {
  const activeOnly =
    operation === "update" ? eq(product.status, "active") : undefined;
  const [target] = await tx
    .select({ customerId: product.customerId })
    .from(product)
    .innerJoin(customer, eq(product.customerId, customer.id))
    .where(
      and(eq(product.id, id), activeOnly, businessScopeWhere(access, customer))
    );
  if (!target) fail(404, "产品不存在。");

  const { record: owner } = await lockCustomerForWrite(
    tx,
    access,
    target.customerId,
    "share",
    operation === "archive"
  );
  const [current] = await tx
    .select()
    .from(product)
    .where(
      and(eq(product.id, id), eq(product.customerId, owner.id), activeOnly)
    )
    .for("update");
  if (
    !current ||
    (owner.status === "archived" && current.status === "active")
  ) {
    fail(404, "产品不存在。");
  }
  if (current.status === "archived") {
    if (current.version !== expectedVersion + 1) fail(404, "产品不存在。");
  } else if (current.version !== expectedVersion) {
    failVersionConflict(productView(current, owner));
  }
  return { current, owner };
}

/** 同一账号重复提交同一份资料时，读取原产品并再次核对客户权限。 */
export function createProduct(
  access: BusinessAccess,
  input: ProductCreateInput,
  requestId: string
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return writeProduct(async (tx) => {
    const lockKey = JSON.stringify([
      "product-create",
      access.userId,
      requestId,
    ]);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );
    const [existing] = await tx
      .select({ id: product.id, customerId: product.customerId })
      .from(product)
      .where(
        and(
          eq(product.createdByUserId, access.userId),
          eq(product.creationRequestId, requestId)
        )
      );
    const { record: owner } = await lockCustomerForWrite(
      tx,
      access,
      existing?.customerId ?? input.customerId,
      "share"
    );
    if (existing) {
      const [saved] = await tx
        .select()
        .from(product)
        .where(activeProduct(existing.id, owner.id))
        .for("share");
      if (!saved) fail(404, "产品不存在。");
      if (saved.creationRequestHash !== requestHash) {
        conflict("idempotency_conflict", "该提交 ID 已用于不同的产品资料。");
      }
      return productView(saved, owner);
    }

    const [created] = await tx
      .insert(product)
      .values({
        ...input,
        createdByUserId: access.userId,
        creationRequestId: requestId,
        creationRequestHash: requestHash,
      })
      .returning();
    return productView(created, owner);
  });
}

/** 合并并校验修改，只有实际字段变更才增加版本。 */
export function updateProduct(
  access: BusinessAccess,
  id: string,
  input: ProductPatch,
  expectedVersion: number
) {
  return writeProduct(async (tx) => {
    const { current, owner } = await lockProductForWrite(
      tx,
      access,
      id,
      expectedVersion,
      "update"
    );
    const changes = resolveProductPatch(current, input);
    const changed = (Object.keys(changes) as (keyof ProductPatch)[]).some(
      (field) => {
        const value = changes[field];
        if (value === undefined) return false;
        // 价格范围和精度已受限，数值比较可忽略存量价格末尾的零。
        return field === "unitPrice"
          ? Number(value) !== Number(current.unitPrice)
          : value !== current[field];
      }
    );
    if (!changed) return productView(current, owner);

    const [updated] = await tx
      .update(product)
      .set({ ...changes, ...revision })
      .where(eq(product.id, id))
      .returning();
    return productView(updated, owner);
  });
}

/** 已完成的归档可按原预期版本重试，直接返回归档结果。 */
export function archiveProduct(
  access: BusinessAccess,
  id: string,
  expectedVersion: number
) {
  return writeProduct(async (tx) => {
    const { current, owner } = await lockProductForWrite(
      tx,
      access,
      id,
      expectedVersion,
      "archive"
    );
    if (current.status === "archived") return productView(current, owner);

    // Payout 新建会共享锁定产品。等待它提交后，在当前写锁内核对有效奖表。
    const [activePayout] = await tx
      .select({ id: payout.id })
      .from(payout)
      .where(and(eq(payout.productId, id), eq(payout.status, "active")))
      .limit(1);
    if (activePayout) {
      conflict("product_payout_conflict", "请先归档该产品的有效 Payout。");
    }

    const [archived] = await tx
      .update(product)
      .set({ status: "archived", ...revision })
      .where(eq(product.id, id))
      .returning();
    return productView(archived, owner);
  });
}
