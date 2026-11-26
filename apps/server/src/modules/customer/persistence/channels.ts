import { customerChannel } from "@repo/db/schema";
import { asc } from "drizzle-orm";

import type { Database } from "../../identity/auth/better-auth";

export function listCustomerChannels(db: Database) {
  return db
    .select({
      code: customerChannel.code,
      name: customerChannel.name,
      color: customerChannel.color,
    })
    .from(customerChannel)
    .orderBy(asc(customerChannel.code));
}
