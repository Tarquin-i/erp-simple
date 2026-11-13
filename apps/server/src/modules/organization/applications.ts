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

/**
 * 锁定申请人的账号记录，使同一账号的申请和入部操作串行执行。
 * @param tx 当前数据库事务，行锁持有至事务结束。
 * @param userId 申请人的账号 ID。
 * @returns 锁定后完成，无业务数据。
 * @throws 申请账号不存在时抛出 HTTP 404 异常。
 */
async function lockApplicant(tx: DatabaseTransaction, userId: string) {
  const [applicant] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update")
    .limit(1);
  if (!applicant) fail(404, "申请账号不存在。");
}

/**
 * 检查申请人是否还没有部门成员身份或公司管理员身份。
 * @param tx 已锁定申请人账号的事务。
 * @param userId 申请人的账号 ID。
 * @returns 校验通过后完成，无业务数据。
 * @throws 账号已具备工作台权限时抛出 HTTP 409 异常。
 */
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

/**
 * 提交入部申请。同一部门已有待审申请时复用原记录。
 * @param userId 申请人的账号 ID。
 * @param departmentId 目标部门 ID。
 * @returns 申请记录 `application`，以及是否新建的标记 `created`。
 * @throws 账号或目标部门不存在时抛出 HTTP 404，已有工作台权限或其他部门的待审申请时抛出 HTTP 409。
 */
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

/**
 * 查询主管所属部门的待审入部申请，按提交时间排序。
 * @param supervisorId 主管的账号 ID。
 * @returns 含申请 ID、申请人姓名、邮箱及提交时间的列表，无待审申请时为空数组。
 * @throws 账号不是部门主管时抛出 HTTP 403 异常。
 */
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

  // 左连接保留没有待审申请的主管记录，用来区分空列表和无查看权限。
  if (!rows.length) fail(403, "只有部门主管可以查看本部门的入部申请。");
  return rows.flatMap(({ id, name, email, submittedAt }) =>
    id !== null && name !== null && email !== null && submittedAt !== null
      ? [{ id, name, email, submittedAt }]
      : []
  );
}

/**
 * 在事务内读取审核人的最新权限范围。
 * @param tx 当前数据库事务。
 * @param userId 审核人的账号 ID。
 * @returns 公司管理员的全公司范围，或主管的部门范围和部门 ID。
 * @throws 账号无审核权限时抛出 HTTP 403 异常。
 */
async function requireReviewScope(tx: DatabaseTransaction, userId: string) {
  const [reviewer] = await tx
    .select({
      adminId: companyAdministrator.userId,
      departmentId: member.organizationId,
      role: member.role,
    })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (reviewer?.adminId) return { scope: "company" as const };
  if (reviewer?.role === "supervisor" && reviewer.departmentId) {
    return {
      scope: "department" as const,
      departmentId: reviewer.departmentId,
    };
  }
  fail(403, "只有公司管理员或部门主管可以审核入部申请。");
}

async function requireApplicationDepartment(
  tx: DatabaseTransaction,
  applicationId: string
) {
  const [application] = await tx
    .select({ departmentId: departmentApplication.organizationId })
    .from(departmentApplication)
    .where(eq(departmentApplication.id, applicationId))
    .limit(1);
  if (!application) fail(404, "未找到入部申请。");
  return application.departmentId;
}

/**
 * 审核待审入部申请。批准时，更新审核记录和创建部门成员在同一事务内完成。
 * @param reviewerId 公司管理员或部门主管的账号 ID。
 * @param applicationId 申请 ID，部门主管只能审核本部门的申请。
 * @param decision 审核决定，`approve` 表示通过，`reject` 表示拒绝。
 * @returns 审核完成后的申请 ID 和状态。
 * @throws 无审核权限时抛出 HTTP 403，找不到可审核的申请时抛出 HTTP 404，申请已处理或批准时发现申请人已有权限则抛出 HTTP 409。
 */
export function reviewApplication(
  reviewerId: string,
  applicationId: string,
  decision: "approve" | "reject"
) {
  return database.db.transaction(async (tx) => {
    const scope = await requireReviewScope(tx, reviewerId);
    const departmentId =
      scope.scope === "company"
        ? await requireApplicationDepartment(tx, applicationId)
        : scope.departmentId;
    await lockDepartment(tx, departmentId);
    // 等待部门锁期间主管可能已更换，拿到锁后重新校验审核权限。
    const currentScope = await requireReviewScope(tx, reviewerId);
    if (
      currentScope.scope === "department" &&
      currentScope.departmentId !== departmentId
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
    if (!application) {
      fail(
        404,
        currentScope.scope === "company"
          ? "未找到入部申请。"
          : "未找到本部门的入部申请。"
      );
    }
    if (application.status !== "pending") fail(409, "该申请已处理。");

    await lockApplicant(tx, application.userId);
    if (decision === "approve")
      await requireUnassignedAccount(tx, application.userId);

    const [reviewed] = await tx
      .update(departmentApplication)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        reviewedAt: new Date(),
        reviewedByUserId: reviewerId,
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
