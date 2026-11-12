import {
  companyAdministrator,
  departmentApplication,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createProvisioningAuth, database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "./departments";
import { fail } from "./errors";

const receiptColumns = {
  id: departmentApplication.id,
  departmentId: departmentApplication.organizationId,
  status: departmentApplication.status,
  submittedAt: departmentApplication.submittedAt,
};

async function lockApplicant(tx: DatabaseTransaction, userId: string) {
  const [applicant] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update")
    .limit(1);
  if (!applicant) fail(404, "申请账号不存在。");
}

async function requireUnassignedAccount(
  tx: DatabaseTransaction,
  userId: string
) {
  const [account] = await tx
    .select({ memberId: member.id, adminId: companyAdministrator.userId })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (account?.memberId || account?.adminId)
    fail(409, "该账号已有工作台权限。");
}

export function submitApplication(userId: string, departmentId: string) {
  return database.db.transaction(async (tx) => {
    await lockApplicant(tx, userId);
    await requireUnassignedAccount(tx, userId);

    const [pending] = await tx
      .select(receiptColumns)
      .from(departmentApplication)
      .where(
        and(
          eq(departmentApplication.userId, userId),
          eq(departmentApplication.status, "pending")
        )
      )
      .limit(1);
    if (pending) {
      if (pending.departmentId !== departmentId)
        fail(409, "你已有一条待审核的入部申请。");
      return { application: pending, created: false };
    }

    const [department] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, departmentId))
      .limit(1);
    if (!department) fail(404, "所选部门不存在。");

    const [application] = await tx
      .insert(departmentApplication)
      .values({ userId, organizationId: departmentId })
      .returning(receiptColumns);
    return { application, created: true };
  });
}

export async function listPendingApplications(supervisorId: string) {
  const rows = await database.db
    .select({
      id: departmentApplication.id,
      name: user.name,
      email: user.email,
      submittedAt: departmentApplication.submittedAt,
    })
    .from(member)
    .leftJoin(
      departmentApplication,
      and(
        eq(departmentApplication.organizationId, member.organizationId),
        eq(departmentApplication.status, "pending")
      )
    )
    .leftJoin(user, eq(user.id, departmentApplication.userId))
    .where(and(eq(member.userId, supervisorId), eq(member.role, "supervisor")))
    .orderBy(
      asc(departmentApplication.submittedAt),
      asc(departmentApplication.id)
    );

  // The left join distinguishes a supervisor with no pending applications from other accounts.
  if (!rows.length) fail(403, "只有部门主管可以查看本部门的入部申请。");
  return rows.flatMap(({ id, name, email, submittedAt }) =>
    id !== null && name !== null && email !== null && submittedAt !== null
      ? [{ id, name, email, submittedAt }]
      : []
  );
}

async function requireSupervisorDepartment(
  tx: DatabaseTransaction,
  userId: string
) {
  const [supervisor] = await tx
    .select({ departmentId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "supervisor")))
    .limit(1);
  if (!supervisor) fail(403, "只有部门主管可以审核本部门的入部申请。");
  return supervisor.departmentId;
}

export function reviewApplication(
  supervisorId: string,
  applicationId: string,
  decision: "approve" | "reject"
) {
  return database.db.transaction(async (tx) => {
    const departmentId = await requireSupervisorDepartment(tx, supervisorId);
    await lockDepartment(tx, departmentId);
    // The current supervisor may have changed while this request waited for the lock.
    if (
      (await requireSupervisorDepartment(tx, supervisorId)) !== departmentId
    ) {
      fail(403, "只有部门主管可以审核本部门的入部申请。");
    }

    const [application] = await tx
      .select({
        userId: departmentApplication.userId,
        status: departmentApplication.status,
      })
      .from(departmentApplication)
      .where(
        and(
          eq(departmentApplication.id, applicationId),
          eq(departmentApplication.organizationId, departmentId)
        )
      )
      .limit(1);
    if (!application) fail(404, "未找到本部门的入部申请。");
    if (application.status !== "pending") fail(409, "该申请已处理。");

    await lockApplicant(tx, application.userId);
    if (decision === "approve")
      await requireUnassignedAccount(tx, application.userId);

    const [reviewed] = await tx
      .update(departmentApplication)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        reviewedAt: new Date(),
        reviewedByUserId: supervisorId,
      })
      .where(
        and(
          eq(departmentApplication.id, applicationId),
          eq(departmentApplication.organizationId, departmentId),
          eq(departmentApplication.status, "pending")
        )
      )
      .returning({
        id: departmentApplication.id,
        status: departmentApplication.status,
      });
    if (!reviewed) fail(409, "该申请已处理。");

    if (decision === "approve") {
      await createProvisioningAuth(tx).api.addMember({
        body: {
          userId: application.userId,
          organizationId: departmentId,
          role: "member",
        },
      });
    }
    return reviewed;
  });
}
