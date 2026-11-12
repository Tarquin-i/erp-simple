import {
  companyAdministrator,
  departmentApplication,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

import { createProvisioningAuth, database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "./errors";

export async function createDepartment(name: string) {
  // A stable URL-safe slug also makes a retry with the same name hit the unique key.
  const slug = `department-${Buffer.from(name.normalize("NFKC").toLowerCase()).toString("base64url")}`;
  const [department] = await database.db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name, slug })
    .onConflictDoNothing({ target: organization.slug })
    .returning({ id: organization.id, name: organization.name });
  if (!department) fail(409, "该部门名称已存在。");
  return department;
}

export async function lockDepartment(
  tx: DatabaseTransaction,
  departmentId: string
) {
  // Reviews and supervisor changes use the same lock, which allows FK references.
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId))
    .for("no key update")
    .limit(1);
  if (!department) fail(404, "该部门不存在。");
}

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

    // A first supervisor can enter the department through this targeted appointment.
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
