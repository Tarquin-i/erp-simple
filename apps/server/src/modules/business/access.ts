import { companyAdministrator, member, user } from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";

import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { requireAccountId } from "../organization/request";

export type BusinessAccess =
  | { scope: "company"; userId: string }
  | { scope: "department"; userId: string; departmentId: string }
  | { scope: "own"; userId: string; departmentId: string };

export type BusinessAccessEnv = {
  Variables: { businessAccess: BusinessAccess };
};

/**
 * 根据管理员身份和部门成员关系计算账号的业务数据范围。
 * @param db 用于读取权限的数据库实例或当前事务。
 * @param userId 当前账号的用户 ID。
 * @returns 公司、部门或本人范围，部门和本人范围包含所属部门 ID。
 * @throws 账号不存在时抛出 HTTP 401，账号既非公司管理员也未加入部门时抛出 HTTP 403。
 */
export async function readBusinessAccess(
  db: typeof database.db | DatabaseTransaction,
  userId: string
): Promise<BusinessAccess> {
  const [identity] = await db
    .select({
      adminId: companyAdministrator.userId,
      membership: { departmentId: member.organizationId, role: member.role },
    })
    .from(user)
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .leftJoin(member, eq(member.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);

  if (!identity) fail(401, "请先登录。");
  if (identity.adminId) return { scope: "company", userId };
  if (!identity.membership) fail(403, "加入部门后才能访问业务数据。");

  const { departmentId, role } = identity.membership;
  return {
    scope: role === "supervisor" ? "department" : "own",
    userId,
    departmentId,
  };
}

// 将会话对应的数据范围写入请求上下文，供后续业务路由读取。
export const requireBusinessAccess = createMiddleware<BusinessAccessEnv>(
  async (c, next) => {
    const userId = await requireAccountId(c.req.raw.headers);
    c.set("businessAccess", await readBusinessAccess(database.db, userId));
    await next();
  }
);

/**
 * 生成业务数据范围条件，直接用于查询、更新和删除的 WHERE 子句。
 * @param access 当前账号的业务范围。
 * @param columns 业务表的部门和负责人字段。
 * @returns 公司范围允许所有行，部门范围匹配所属部门，本人范围同时匹配部门和负责人。
 */
export function businessScopeWhere(
  access: BusinessAccess,
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

/**
 * 校验新增记录或变更负责人后的目标范围。具体模块仍需校验负责人资格。
 * @param access 当前账号的业务范围。
 * @param target 目标部门和负责人，未指定负责人时传 `null`。
 * @returns 校验通过时无返回值。
 * @throws 目标超出当前账号的数据范围时抛出 HTTP 403。
 */
export function assertBusinessWriteTarget(
  access: BusinessAccess,
  target: { departmentId: string; ownerUserId: string | null }
) {
  if (access.scope === "company") return;

  if (
    target.departmentId !== access.departmentId ||
    (access.scope === "own" && target.ownerUserId !== access.userId)
  ) {
    fail(403, "无权将业务数据写入该范围。");
  }
}
