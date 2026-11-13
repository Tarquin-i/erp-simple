import {
  companyAdministrator,
  departmentApplication,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createProvisioningAuth, database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "./errors";

/**
 * 查询部门选项，按部门名称和 ID 排序。
 * @param db 查询使用的数据库实例或事务，默认使用共享数据库实例。
 * @returns 可等待的查询，结果包含各部门的 ID 和名称。
 */
export function listDepartments(
  db: typeof database.db | DatabaseTransaction = database.db
) {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name), asc(organization.id));
}

/**
 * 在同一个只读、可重复读事务内汇总部门、成员和待审申请，确保名单来自同一快照。
 * @returns 每个部门的资料、成员和待审申请人列表。成员和申请人均排除公司管理员，待审列表仅包含尚未入部的账号。
 */
export function listDepartmentRoster() {
  return database.db.transaction(
    async (tx) => {
      const departments = await listDepartments(tx);
      const account = { id: user.id, name: user.name, email: user.email };
      const memberships = await tx
        .select({
          departmentId: member.organizationId,
          account: { ...account, role: member.role },
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(
          companyAdministrator,
          eq(companyAdministrator.userId, user.id)
        )
        .where(isNull(companyAdministrator.userId))
        .orderBy(asc(user.name), asc(user.email), asc(user.id));
      const applications = await tx
        .select({
          departmentId: departmentApplication.organizationId,
          account: { ...account, applicationId: departmentApplication.id },
        })
        .from(departmentApplication)
        .innerJoin(user, eq(departmentApplication.userId, user.id))
        .leftJoin(member, eq(member.userId, user.id))
        .leftJoin(
          companyAdministrator,
          eq(companyAdministrator.userId, user.id)
        )
        .where(
          and(
            eq(departmentApplication.status, "pending"),
            isNull(member.id),
            isNull(companyAdministrator.userId)
          )
        )
        .orderBy(asc(user.name), asc(user.email), asc(user.id));

      const roster = new Map(
        departments.map((department) => [
          department.id,
          {
            ...department,
            members: [] as (typeof memberships)[number]["account"][],
            pendingApplicants: [] as (typeof applications)[number]["account"][],
          },
        ])
      );
      for (const { departmentId, account } of memberships) {
        roster.get(departmentId)?.members.push(account);
      }
      for (const { departmentId, account } of applications) {
        roster.get(departmentId)?.pendingApplicants.push(account);
      }
      return [...roster.values()];
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

/**
 * 新建部门，根据规范化后的名称生成固定的 slug。
 * @param name 已校验的部门名称。
 * @returns 新部门的 ID 和名称。
 * @throws 规范化后的部门名称已存在时抛出 HTTP 409 异常。
 */
export async function createDepartment(name: string) {
  // 用 NFKC 和小写统一名称后编码，使同名重试命中同一个唯一键。
  const slug = `department-${Buffer.from(name.normalize("NFKC").toLowerCase()).toString("base64url")}`;
  const [department] = await database.db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name, slug })
    .onConflictDoNothing({ target: organization.slug })
    .returning({ id: organization.id, name: organization.name });
  if (!department) fail(409, "该部门名称已存在。");
  return department;
}

/**
 * 为部门加行锁，使该部门的申请审核、主管任命和客户写入串行执行。
 * @param tx 当前数据库事务，行锁持有至事务结束。
 * @param departmentId 要锁定的部门 ID。
 * @returns 锁定后完成，无业务数据。
 * @throws 部门不存在时抛出 HTTP 404 异常。
 */
export async function lockDepartment(
  tx: DatabaseTransaction,
  departmentId: string
) {
  // FOR NO KEY UPDATE 会互斥这些操作，同时允许外键引用部门。
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId))
    .for("no key update")
    .limit(1);
  if (!department) fail(404, "该部门不存在。");
}

/**
 * 在事务中任命部门主管，同时将原主管降为普通成员。候选人已是本部门主管时直接返回。
 * @param departmentId 要任命主管的部门 ID。
 * @param email 候选人注册时使用的邮箱。
 * @param adminId 路由已校验的公司管理员账号 ID，用于记录审核人。
 * @returns 部门 ID、候选人账号 ID 和 `supervisor` 角色。
 * @throws 部门或候选账号不存在时抛出 HTTP 404，候选人为公司管理员、属于其他部门或尚未入部且缺少本部门待审申请时抛出 HTTP 409。
 */
export function appointSupervisor(
  departmentId: string,
  email: string,
  adminId: string
) {
  return database.db.transaction(async (tx) => {
    await lockDepartment(tx, departmentId);

    const [candidate] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .for("update")
      .limit(1);
    if (!candidate) fail(404, "未找到这个邮箱对应的注册账号。");
    const [candidateAdmin] = await tx
      .select({ userId: companyAdministrator.userId })
      .from(companyAdministrator)
      .where(eq(companyAdministrator.userId, candidate.id))
      .limit(1);
    if (candidateAdmin) fail(409, "公司管理员使用全局角色，主管须是部门员工。");

    const [membership] = await tx
      .select({
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, candidate.id))
      .limit(1);
    if (membership && membership.organizationId !== departmentId) {
      fail(409, "此员工已加入其他部门。");
    }

    const result = {
      departmentId,
      userId: candidate.id,
      role: "supervisor" as const,
    };
    if (membership?.role === "supervisor") return result;

    // 候选人尚未入部时，在任命事务中同时通过其待审申请。
    if (!membership) {
      const [application] = await tx
        .update(departmentApplication)
        .set({
          status: "approved",
          reviewedAt: new Date(),
          reviewedByUserId: adminId,
        })
        .where(
          and(
            eq(departmentApplication.userId, candidate.id),
            eq(departmentApplication.organizationId, departmentId),
            eq(departmentApplication.status, "pending")
          )
        )
        .returning({ id: departmentApplication.id });
      if (!application) fail(409, "请让这名员工先申请加入该部门。");
    }

    await tx
      .update(member)
      .set({ role: "member" })
      .where(
        and(
          eq(member.organizationId, departmentId),
          eq(member.role, "supervisor")
        )
      );
    if (membership) {
      await tx
        .update(member)
        .set({ role: "supervisor" })
        .where(eq(member.id, membership.id));
    } else {
      await createProvisioningAuth(tx).api.addMember({
        body: {
          userId: candidate.id,
          organizationId: departmentId,
          role: "supervisor",
        },
      });
    }
    return result;
  });
}
