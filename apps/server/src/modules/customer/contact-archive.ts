import { customerContact } from "@repo/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "../identity/auth/better-auth";

export function contactArchiveFields(actorUserId: string, archivedAt: Date) {
  return {
    archivedAt,
    archivedByUserId: actorUserId,
    updatedAt: archivedAt,
    version: sql`${customerContact.version} + 1`,
  };
}

/** 在客户锁内归档联系人组，联系方式通过所属联系人退出业务查询。 */
export async function archiveCustomerContacts(
  tx: DatabaseTransaction,
  customerId: string,
  actorUserId: string,
  archivedAt: Date
) {
  await tx
    .update(customerContact)
    .set(contactArchiveFields(actorUserId, archivedAt))
    .where(
      and(
        eq(customerContact.customerId, customerId),
        isNull(customerContact.archivedAt)
      )
    );
}
