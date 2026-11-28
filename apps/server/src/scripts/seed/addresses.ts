import type { DatabaseTransaction } from "@repo/db";
import { customerAddress } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

import { prepareDeliveryAddressCreateFields } from "../../modules/address";
import { seedAddresses } from "./address-definitions";
import { seedId } from "./seed-ids";

export async function seedCustomerAddresses(
  tx: DatabaseTransaction,
  customerId: string,
  customerIndex: number,
  customerCreatedAt: Date
) {
  const addresses = seedAddresses.filter(
    (address) => address.customerIndex === customerIndex
  );
  if (!addresses.length) return 0;

  const [currentDefault] = await tx
    .select({ id: customerAddress.id })
    .from(customerAddress)
    .where(
      and(
        eq(customerAddress.customerId, customerId),
        eq(customerAddress.isDefault, true)
      )
    )
    .limit(1);
  let hasDefault = Boolean(currentDefault);
  let count = 0;
  for (const { index, input } of addresses) {
    const createdAt = new Date(customerCreatedAt.getTime() + index * 3600000);
    const [created] = await tx
      .insert(customerAddress)
      .values({
        ...prepareDeliveryAddressCreateFields(input),
        id: seedId("address", index),
        customerId,
        isDefault: !hasDefault,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: customerAddress.id })
      .returning({ id: customerAddress.id });
    if (created) {
      hasDefault = true;
      count++;
    }
  }
  return count;
}
