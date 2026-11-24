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
import { fail } from "../organization/errors";

type Payout = typeof payout.$inferSelect;

export interface PayoutSource {
  id: string;
  productNo: string;
  name: string;
  customerId: string;
  customerNo: string;
  companyName: string;
  currencyCode: string;
}

interface PayoutFilters {
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

// 金额入库时已经校验精度。先按十进制文本转整数，再计算和舍入。
function decimalUnits(value: string, decimals: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
}

function formatCents(cents: bigint) {
  const absoluteCents = cents < 0n ? -cents : cents;
  const fraction = (absoluteCents % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${absoluteCents / 100n}.${fraction}`;
}

function payoutMetrics({ definition, ticketCount, unitPrice }: Payout) {
  let winningTicketCount = 0;
  let payoutCents = 0n;
  for (const { prizes } of definition.groups) {
    for (const { amount, quantity } of prizes) {
      winningTicketCount += quantity;
      payoutCents += decimalUnits(String(amount), 2) * BigInt(quantity);
    }
  }

  const salesUnits = decimalUnits(unitPrice, 4) * BigInt(ticketCount);
  const salesCents = (salesUnits + 50n) / 100n;
  // 和参考奖表一致，用舍入到分的销售额和赔付额计算两位小数的百分比。
  const paybackPercent =
    winningTicketCount > 0 && salesCents > 0n
      ? formatCents((payoutCents * 10_000n + salesCents / 2n) / salesCents)
      : null;

  return {
    winningTicketCount,
    losingTicketCount: ticketCount - winningTicketCount,
    salesAmount: formatCents(salesCents),
    payoutAmount: formatCents(payoutCents),
    profitAmount:
      winningTicketCount > 0 ? formatCents(salesCents - payoutCents) : null,
    paybackPercent,
  };
}

function payoutSummary(row: Payout, source: PayoutSource) {
  const {
    normalizedName,
    creationRequestId,
    creationRequestHash,
    definition,
    ...fields
  } = row;
  const { id, productNo, name, customerId, customerNo, companyName } = source;
  return {
    ...fields,
    product: { id, productNo, name },
    customer: { id: customerId, customerNo, companyName },
    metrics: payoutMetrics(row),
  };
}

/** 生成详情和写入响应共用的 Payout 视图。 */
export function payoutView(row: Payout, source: PayoutSource) {
  return { ...payoutSummary(row, source), definition: row.definition };
}

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

/** 使用同一只读快照读取权限、列表及总数。 */
export function listPayouts(
  access: BusinessAccess,
  { products, page, pageSize, search }: PayoutFilters
) {
  const productMatches = products?.excluded ? notInArray : inArray;
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    const filter = and(
      activePayoutScope(freshAccess),
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

    return {
      payouts: rows.map((row) => payoutSummary(row.payout, row.source)),
      total: total.count,
      page,
      pageSize,
    };
  });
}

/** 详情权限随产品关联客户变更，归档或不可见时返回 404。 */
export function getPayout(access: BusinessAccess, id: string) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    const [row] = await tx
      .select({ payout, source: payoutSourceFields })
      .from(payout)
      .innerJoin(product, eq(product.id, payout.productId))
      .innerJoin(customer, eq(customer.id, product.customerId))
      .where(and(eq(payout.id, id), activePayoutScope(freshAccess)))
      .limit(1);
    if (!row) fail(404, "Payout 不存在。");
    return payoutView(row.payout, row.source);
  });
}
