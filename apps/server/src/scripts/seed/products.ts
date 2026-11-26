import type { DatabaseTransaction } from "@repo/db";
import { product } from "@repo/db/schema";
import type { customer } from "@repo/db/schema";

import { readProductCreateInput } from "../../modules/product/http/write-requests";
import {
  seedProductDefaults,
  seedProductTemplates,
  seedProductTypesByCustomer,
} from "./product-definitions";
import { seedId } from "./seed-ids";

export async function seedCustomerProducts(
  tx: DatabaseTransaction,
  customerIndex: number,
  record: Pick<typeof customer.$inferSelect, "id" | "ownerUserId" | "createdAt">
) {
  const types = seedProductTypesByCustomer.get(customerIndex);
  if (!types) return 0;

  const values = types.map((productType) => {
    const { index, name, ...details } = seedProductTemplates[productType];
    const fixtureNumber = customerIndex * 10 + index;
    const createdAt = new Date(record.createdAt.getTime() + index * 3600000);
    return {
      ...readProductCreateInput({
        customerId: record.id,
        productType,
        name: `演示·${name}`,
        ...seedProductDefaults,
        ...details,
      }),
      id: seedId("product", fixtureNumber),
      productNo: `P${String(fixtureNumber).padStart(6, "0")}`,
      createdByUserId: record.ownerUserId,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // 固定 ID 和种子编号，重复执行时保留产品的修改和归档状态。
  const inserted = await tx
    .insert(product)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: product.id });
  return inserted.length;
}
