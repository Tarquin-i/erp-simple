import type { Database, DatabaseTransaction } from "@repo/db";
import { organization } from "@repo/db/schema";
import { asc, eq } from "drizzle-orm";

import { fail } from "../../../errors";

export function selectDepartments(db: Database | DatabaseTransaction) {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name), asc(organization.id));
}

export async function insertDepartment(
  db: Database,
  name: string,
  slug: string
) {
  const [department] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name, slug })
    .onConflictDoNothing({ target: organization.slug })
    .returning({ id: organization.id, name: organization.name });
  return department;
}

/**
 * 协调部门权限变更与业务写入。行锁持有至调用方事务结束。
 * 审核和任命使用 NO KEY UPDATE，业务写入使用 SHARE。
 */
export async function lockDepartment(
  tx: DatabaseTransaction,
  departmentId: string,
  mode: "share" | "no key update" = "no key update"
) {
  // 两种模式都允许外键检查获取 FOR KEY SHARE。
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId))
    .for(mode)
    .limit(1);
  if (!department) fail(404, "该部门不存在。");
}
