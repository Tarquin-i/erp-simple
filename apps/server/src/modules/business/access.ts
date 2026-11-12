import { companyAdministrator, member, user } from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";

import { database } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { requireAccountId } from "../organization/request";

export type BusinessAccess =
  | { scope: "company"; userId: string }
  | { scope: "department"; userId: string; departmentId: string }
  | { scope: "own"; userId: string; departmentId: string };

export type BusinessAccessEnv = {
  Variables: { businessAccess: BusinessAccess };
};

export const requireBusinessAccess = createMiddleware<BusinessAccessEnv>(
  async (c, next) => {
    const userId = await requireAccountId(c.req.raw.headers);
    const [identity] = await database.db
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
    if (identity.adminId) {
      c.set("businessAccess", { scope: "company", userId });
    } else if (identity.membership) {
      const { departmentId, role } = identity.membership;
      c.set("businessAccess", {
        scope: role === "supervisor" ? "department" : "own",
        userId,
        departmentId,
      });
    } else {
      fail(403, "加入部门后才能访问业务数据。");
    }

    await next();
  }
);

// Apply this predicate in the query itself, including the WHERE of updates and deletes.
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

// Check the destination scope for inserts and ownership changes. Resource-specific
// assignment rules still apply.
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
