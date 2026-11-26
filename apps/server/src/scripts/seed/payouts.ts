import type { DatabaseTransaction } from "@repo/db";
import { customer, payout, product } from "@repo/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { assertPayoutTicketCapacity } from "../../modules/payout/application/errors";
import { readPayoutCreateInput } from "../../modules/payout/http/write-requests";
import { seedPayoutDefinitions, seedPayoutEntries } from "./payout-definitions";
import { seedProductTemplates } from "./product-definitions";
import { seedId } from "./seed-ids";

export async function seedPayouts(tx: DatabaseTransaction) {
  const fixtures = seedPayoutEntries.map(
    ({ customerIndex, productType, ...data }) => ({
      ...data,
      productId: seedId(
        "product",
        customerIndex * 10 + seedProductTemplates[productType].index
      ),
    })
  );
  const activeProducts = await tx
    .select({
      id: product.id,
      currencyCode: product.currencyCode,
      createdAt: product.createdAt,
      ownerUserId: customer.ownerUserId,
    })
    .from(product)
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(
      and(
        inArray(
          product.id,
          fixtures.map(({ productId }) => productId)
        ),
        eq(product.status, "active")
      )
    )
    .for("share", { of: product });
  const productsById = new Map(activeProducts.map((item) => [item.id, item]));
  const values: (typeof payout.$inferInsert)[] = [];

  for (const {
    index,
    productId,
    name,
    ticketCount,
    unitPrice,
    plan,
  } of fixtures) {
    const source = productsById.get(productId);
    if (!source) continue;

    const definition = seedPayoutDefinitions[plan];
    const createdAt = new Date(source.createdAt.getTime() + index * 60000);
    assertPayoutTicketCapacity(definition, ticketCount);
    values.push({
      ...readPayoutCreateInput({
        productId,
        name: `演示·${name}`,
        ticketCount,
        unitPrice,
        remark: "演示奖表，发行张数和赔付数据仅供流程测试。",
      }),
      id: seedId("payout", index),
      currencyCode: source.currencyCode,
      definition,
      createdByUserId: source.ownerUserId,
      updatedByUserId: source.ownerUserId,
      createdAt,
      updatedAt: createdAt,
    });
  }
  if (!values.length) return 0;

  // 固定 ID，重复执行时保留已编辑或归档的奖表，也保留用户新建的同名奖表。
  const inserted = await tx
    .insert(payout)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: payout.id });
  return inserted.length;
}
