import type { DatabaseTransaction } from "@repo/db";
import { companyAdministrator, user } from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";

/** 首次管理员初始化和本地种子共用此锁，持有至调用方事务结束。 */
export async function lockCompanyAdminInitialization(tx: DatabaseTransaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('erp:init-company-admin'))`
  );
}

export async function findAccountWithAdminStatus(
  tx: DatabaseTransaction,
  email: string
) {
  const [account] = await tx
    .select({ adminId: companyAdministrator.userId })
    .from(user)
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(eq(user.email, email))
    .limit(1);
  return account;
}

export async function findAnyCompanyAdministrator(tx: DatabaseTransaction) {
  const [admin] = await tx
    .select({ userId: companyAdministrator.userId })
    .from(companyAdministrator)
    .limit(1);
  return admin;
}

export function insertCompanyAdministrator(
  tx: DatabaseTransaction,
  userId: string
) {
  return tx.insert(companyAdministrator).values({ userId });
}
