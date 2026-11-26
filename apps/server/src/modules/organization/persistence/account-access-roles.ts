import type { Database, DatabaseTransaction } from "@repo/db";
import { companyAdministrator, member, user } from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { AccountRecordAccess } from "../application/account-record-access";

/** 读取账号的公司管理员身份和部门成员角色。 */
export async function selectAccountAccessRoles(
  db: Database | DatabaseTransaction,
  userId: string
) {
  const [roles] = await db
    .select({
      adminId: companyAdministrator.userId,
      membership: { departmentId: member.organizationId, role: member.role },
    })
    .from(user)
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .leftJoin(member, eq(member.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  return roles;
}

/**
 * 生成业务数据范围条件，直接用于查询、更新和删除的 WHERE 子句。
 * @param access 当前账号的业务范围。
 * @param columns 业务表的部门和负责人字段。
 * @returns 公司范围允许所有行，部门范围匹配所属部门，本人范围同时匹配部门和负责人。
 */
export function recordScopeWhere(
  access: AccountRecordAccess,
  columns: {
    departmentId: AnyPgColumn<{ data: string }>;
    ownerUserId: AnyPgColumn<{ data: string }>;
  }
): SQL {
  if (access.scope === "company") return sql`true`;

  const inDepartment = eq(columns.departmentId, access.departmentId);
  if (access.scope === "department") return inDepartment;

  return sql`(${inDepartment} and ${eq(columns.ownerUserId, access.userId)})`;
}
