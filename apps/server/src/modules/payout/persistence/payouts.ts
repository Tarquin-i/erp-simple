import {
  customer,
  normalizePayoutName,
  payout,
  product,
} from "@repo/db/schema";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { businessScopeWhere } from "../../business/access";
import type { BusinessAccess } from "../../business/access";
import type { ListOptionFilter } from "../../business/list-option-filter";
import type { DatabaseTransaction } from "../../identity/auth/better-auth";

export type PayoutRow = typeof payout.$inferSelect;
export type PayoutCreateInput = Pick<
  PayoutRow,
  "productId" | "name" | "ticketCount" | "unitPrice" | "remark"
>;
export type PayoutPatch = Partial<
  Pick<PayoutRow, "name" | "unitPrice" | "remark" | "definition">
>;

export interface PayoutSource {
  id: string;
  productNo: string;
  name: string;
  customerId: string;
  customerNo: string;
  companyName: string;
  currencyCode: string;
}

export interface PayoutFilters {
  products?: ListOptionFilter;
  page: number;
  pageSize: number;
  search?: string;
}

const payoutSourceFields = {
  id: product.id,
  productNo: product.productNo,
  name: product.name,
  customerId: customer.id,
  customerNo: customer.customerNo,
  companyName: customer.companyName,
  currencyCode: product.currencyCode,
};

function activePayoutScope(access: BusinessAccess) {
  return and(
    eq(payout.status, "active"),
    eq(product.status, "active"),
    businessScopeWhere(access, customer)
  );
}

function payoutSearchWhere(search: string) {
  const term = normalizePayoutName(search);
  return or(
    sql`position(${term} in ${payout.normalizedName}) > 0`,
    sql`position(${term} in ${product.normalizedName}) > 0`
  );
}

export async function selectPayoutPage(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  { products, page, pageSize, search }: PayoutFilters
) {
  const productMatches = products?.excluded ? notInArray : inArray;
  const filter = and(
    activePayoutScope(access),
    products ? productMatches(payout.productId, products.values) : undefined,
    search === undefined ? undefined : payoutSearchWhere(search)
  );
  const rows = await tx
    .select({ payout, source: payoutSourceFields })
    .from(payout)
    .innerJoin(product, eq(product.id, payout.productId))
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(filter)
    .orderBy(desc(payout.createdAt), desc(payout.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await tx
    .select({ count: count() })
    .from(payout)
    .innerJoin(product, eq(product.id, payout.productId))
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(filter);
  return { rows, total: total.count, page, pageSize };
}

export async function selectPayoutDetail(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string
) {
  const [row] = await tx
    .select({ payout, source: payoutSourceFields })
    .from(payout)
    .innerJoin(product, eq(product.id, payout.productId))
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(and(eq(payout.id, id), activePayoutScope(access)))
    .limit(1);
  return row;
}

export async function findPayoutProductId(tx: DatabaseTransaction, id: string) {
  const [target] = await tx
    .select({ productId: payout.productId })
    .from(payout)
    .where(eq(payout.id, id));
  return target?.productId;
}

export async function lockPayoutRow(
  tx: DatabaseTransaction,
  id: string,
  productId: string,
  mode: "share" | "update"
) {
  const [record] = await tx
    .select()
    .from(payout)
    .where(and(eq(payout.id, id), eq(payout.productId, productId)))
    .for(mode);
  return record;
}

export async function lockPayoutCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  const lockKey = JSON.stringify(["payout-create", userId, requestId]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  );

  const [existing] = await tx
    .select({ id: payout.id })
    .from(payout)
    .where(
      and(
        eq(payout.createdByUserId, userId),
        eq(payout.creationRequestId, requestId)
      )
    );
  return existing?.id;
}

export async function insertPayout(
  tx: DatabaseTransaction,
  input: PayoutCreateInput,
  {
    currencyCode,
    userId,
    requestId,
    requestHash,
  }: {
    currencyCode: string;
    userId: string;
    requestId: string;
    requestHash: string;
  }
) {
  const [record] = await tx
    .insert(payout)
    .values({
      ...input,
      currencyCode,
      createdByUserId: userId,
      updatedByUserId: userId,
      creationRequestId: requestId,
      creationRequestHash: requestHash,
    })
    .returning();
  return record;
}

export async function hasConflictingPayoutName(
  tx: DatabaseTransaction,
  productId: string,
  id: string,
  name: string
) {
  // 使用与生成列一致的默认排序规则。
  const [duplicate] = await tx
    .select({ id: payout.id })
    .from(payout)
    .where(
      and(
        eq(payout.productId, productId),
        eq(payout.status, "active"),
        eq(
          payout.normalizedName,
          sql`${normalizePayoutName(name)} collate pg_catalog."default"`
        ),
        ne(payout.id, id)
      )
    )
    .limit(1);
  return Boolean(duplicate);
}

function payoutRevision(userId: string) {
  return {
    version: sql`${payout.version} + 1`,
    updatedAt: sql`clock_timestamp()`,
    updatedByUserId: userId,
  };
}

export async function updatePayoutRow(
  tx: DatabaseTransaction,
  id: string,
  userId: string,
  input: PayoutPatch
) {
  const [updated] = await tx
    .update(payout)
    .set({ ...input, ...payoutRevision(userId) })
    .where(eq(payout.id, id))
    .returning();
  return updated;
}

export async function archivePayoutRow(
  tx: DatabaseTransaction,
  id: string,
  userId: string
) {
  const [archived] = await tx
    .update(payout)
    .set({ status: "archived", ...payoutRevision(userId) })
    .where(and(eq(payout.id, id), eq(payout.status, "active")))
    .returning();
  return archived;
}
