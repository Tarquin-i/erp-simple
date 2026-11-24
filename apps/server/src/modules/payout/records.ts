import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { customer, payout, product } from "@repo/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { businessScopeWhere } from "../business/access";
import type { BusinessAccess } from "../business/access";
import { failVersionConflict, isConstraintError } from "../customer/input";
import { lockCustomerForWrite } from "../customer/records";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";

import { assertPayoutTicketCapacity, maxPayoutNameLength } from "./input";
import type { PayoutCopyInput, PayoutCreateInput, PayoutPatch } from "./input";
import { payoutView } from "./queries";
import type { PayoutSource } from "./queries";

const payoutNotFound = "Payout 不存在。";
const productNotFound = "产品不存在。";
const activePayout = eq(payout.status, "active");

function conflict(code: string, message: string): never {
  throw new HTTPException(409, {
    res: Response.json({ code, message }, { status: 409 }),
  });
}

async function writePayout<T>(write: (tx: DatabaseTransaction) => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(write);
    } catch (error) {
      if (
        isConstraintError(error, "23505", "payout_product_active_name_unique")
      ) {
        conflict("payout_name_conflict", "该产品已有同名的有效 Payout。");
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
      if (attempt >= 3) fail(409, "Payout 有并发更新，请重试。");
    }
  }
}

/** 与产品归档按相同顺序加锁，重新核对权限后再读取产品。 */
async function lockPayoutProduct(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  notFound: string,
  includeArchived = false
): Promise<PayoutSource> {
  const [target] = await tx
    .select({ customerId: product.customerId })
    .from(product)
    .innerJoin(customer, eq(product.customerId, customer.id))
    .where(and(eq(product.id, id), businessScopeWhere(access, customer)));
  if (!target) fail(404, notFound);

  const { record: owner } = await lockCustomerForWrite(
    tx,
    access,
    target.customerId,
    "share"
  ).catch((error: unknown) => {
    if (error instanceof HTTPException && error.status === 404) {
      fail(404, notFound);
    }
    throw error;
  });
  const [source] = await tx
    .select({
      id: product.id,
      productNo: product.productNo,
      name: product.name,
      status: product.status,
      currencyCode: product.currencyCode,
    })
    .from(product)
    .where(and(eq(product.id, id), eq(product.customerId, owner.id)))
    .for("share");
  if (!source || (!includeArchived && source.status !== "active")) {
    fail(404, notFound);
  }

  return {
    ...source,
    customerId: owner.id,
    customerNo: owner.customerNo,
    companyName: owner.companyName,
  };
}

async function lockPayoutForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  operation: "copy" | "update" | "archive"
) {
  const [target] = await tx
    .select({ productId: payout.productId })
    .from(payout)
    .where(eq(payout.id, id));
  if (!target) fail(404, payoutNotFound);

  const archiving = operation === "archive";
  const source = await lockPayoutProduct(
    tx,
    access,
    target.productId,
    payoutNotFound,
    archiving
  );
  const [record] = await tx
    .select()
    .from(payout)
    .where(and(eq(payout.id, id), eq(payout.productId, source.id)))
    .for(operation === "copy" ? "share" : "update");
  if (!record || (!archiving && record.status !== "active")) {
    fail(404, payoutNotFound);
  }
  return { record, source };
}

type PayoutCreation =
  | { kind: "create"; input: PayoutCreateInput }
  | { kind: "copy"; fromId: string; input: PayoutCopyInput };

async function preparePayoutCreation(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  creation: PayoutCreation
) {
  const { input } = creation;
  const id = crypto.randomUUID();
  if (creation.kind === "create") {
    const source = await lockPayoutProduct(
      tx,
      access,
      creation.input.productId,
      productNotFound
    );
    return {
      source,
      values: {
        ...creation.input,
        id,
        currencyCode: source.currencyCode,
      },
    };
  }

  const { record, source } = await lockPayoutForWrite(
    tx,
    access,
    creation.fromId,
    "copy"
  );
  assertPayoutTicketCapacity(record.definition, input.ticketCount);
  const suffix = ` 副本 ${id.slice(0, 8)}`;
  const copyName = record.name
    .slice(0, maxPayoutNameLength - suffix.length)
    .replace(/[\uD800-\uDBFF]$/u, "");
  return {
    source,
    values: {
      id,
      productId: record.productId,
      name: input.name ?? `${copyName}${suffix}`,
      ticketCount: input.ticketCount,
      currencyCode: record.currencyCode,
      unitPrice: record.unitPrice,
      definition: record.definition,
      remark: record.remark,
      copiedFromPayoutId: record.id,
    },
  };
}

/** 同一账号用同一提交 ID 重试，只会得到第一次保存的记录。 */
function saveNewPayout(
  access: BusinessAccess,
  creation: PayoutCreation,
  requestId: string
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(creation))
    .digest("hex");
  return writePayout(async (tx) => {
    const lockKey = JSON.stringify(["payout-create", access.userId, requestId]);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );

    const [existing] = await tx
      .select({ id: payout.id })
      .from(payout)
      .where(
        and(
          eq(payout.createdByUserId, access.userId),
          eq(payout.creationRequestId, requestId)
        )
      );
    if (existing) {
      const { record, source } = await lockPayoutForWrite(
        tx,
        access,
        existing.id,
        "copy"
      );
      if (record.creationRequestHash !== requestHash) {
        conflict(
          "idempotency_conflict",
          "该提交 ID 已用于不同的 Payout 资料。"
        );
      }
      return payoutView(record, source);
    }

    const { source, values } = await preparePayoutCreation(
      tx,
      access,
      creation
    );
    const [record] = await tx
      .insert(payout)
      .values({
        ...values,
        createdByUserId: access.userId,
        updatedByUserId: access.userId,
        creationRequestId: requestId,
        creationRequestHash: requestHash,
      })
      .returning();
    return payoutView(record, source);
  });
}

export function createPayout(
  access: BusinessAccess,
  input: PayoutCreateInput,
  requestId: string
) {
  return saveNewPayout(access, { kind: "create", input }, requestId);
}

export function copyPayout(
  access: BusinessAccess,
  fromId: string,
  input: PayoutCopyInput,
  requestId: string
) {
  return saveNewPayout(access, { kind: "copy", fromId, input }, requestId);
}

function payoutRevision(userId: string) {
  return {
    version: sql`${payout.version} + 1`,
    updatedAt: sql`clock_timestamp()`,
    updatedByUserId: userId,
  };
}

export function updatePayout(
  access: BusinessAccess,
  id: string,
  input: PayoutPatch,
  expectedVersion: number
) {
  return writePayout(async (tx) => {
    const { record, source } = await lockPayoutForWrite(
      tx,
      access,
      id,
      "update"
    );
    if (record.version !== expectedVersion)
      failVersionConflict(payoutView(record, source));
    if (input.definition !== undefined) {
      assertPayoutTicketCapacity(input.definition, record.ticketCount);
    }

    const changed =
      (input.name !== undefined && input.name !== record.name) ||
      (input.unitPrice !== undefined &&
        Number(input.unitPrice) !== Number(record.unitPrice)) ||
      (input.remark !== undefined && input.remark !== record.remark) ||
      (input.definition !== undefined &&
        !isDeepStrictEqual(input.definition, record.definition));
    if (!changed) return payoutView(record, source);

    const [updated] = await tx
      .update(payout)
      .set({ ...input, ...payoutRevision(access.userId) })
      .where(eq(payout.id, id))
      .returning();
    return payoutView(updated, source);
  });
}

export function archivePayout(
  access: BusinessAccess,
  id: string,
  expectedVersion: number
) {
  return writePayout(async (tx) => {
    const { record, source } = await lockPayoutForWrite(
      tx,
      access,
      id,
      "archive"
    );
    if (record.status === "archived") {
      if (record.version !== expectedVersion + 1) fail(404, payoutNotFound);
      return payoutView(record, source);
    }
    if (record.version !== expectedVersion)
      failVersionConflict(payoutView(record, source));

    const [archived] = await tx
      .update(payout)
      .set({ status: "archived", ...payoutRevision(access.userId) })
      .where(and(eq(payout.id, id), activePayout))
      .returning();
    return payoutView(archived, source);
  });
}
