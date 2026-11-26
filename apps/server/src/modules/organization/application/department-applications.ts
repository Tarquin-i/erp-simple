import type {
  Database,
  DatabaseTransaction,
} from "../../identity/auth/better-auth";
import { fail } from "../../../errors";
import {
  departmentExists,
  insertDepartmentApplication,
  lockApplicantAccount,
  selectApplicantMembership,
  selectApplicationDepartment,
  selectApplicationReviewer,
  selectDepartmentApplicationForReview,
  selectPendingApplicationForAccount,
  selectSupervisorPendingApplications,
  updatePendingApplicationStatus,
} from "../persistence/department-applications";
import { lockDepartment } from "../persistence/departments";
import { addDepartmentMember } from "../persistence/members";
import { failOrganization } from "./errors";

async function requireLockedApplicant(tx: DatabaseTransaction, userId: string) {
  if (!(await lockApplicantAccount(tx, userId))) fail(404, "申请账号不存在。");
}

async function requireUnassignedAccount(
  tx: DatabaseTransaction,
  userId: string
) {
  const account = await selectApplicantMembership(tx, userId);
  if (account?.memberId || account?.adminId) {
    fail(409, "该账号已有工作台权限。");
  }
}

async function requireReviewScope(tx: DatabaseTransaction, userId: string) {
  const reviewer = await selectApplicationReviewer(tx, userId);
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
  const application = await selectApplicationDepartment(tx, applicationId);
  if (!application) fail(404, "未找到入部申请。");
  return application.departmentId;
}

export function createDepartmentApplicationUseCases(db: Database) {
  return {
    /** 同一部门已有待审申请时复用原记录。 */
    submitApplication(userId: string, departmentId: string) {
      return db.transaction(async (tx) => {
        await requireLockedApplicant(tx, userId);
        await requireUnassignedAccount(tx, userId);

        const pending = await selectPendingApplicationForAccount(tx, userId);
        if (pending) {
          if (pending.departmentId !== departmentId) {
            fail(409, "你已有一条待审核的入部申请。");
          }
          return { application: pending, created: false };
        }

        if (!(await departmentExists(tx, departmentId))) {
          fail(404, "所选部门不存在。");
        }
        const application = await insertDepartmentApplication(
          tx,
          userId,
          departmentId
        );
        return { application, created: true };
      });
    },

    async listPendingApplications(supervisorId: string) {
      const rows = await selectSupervisorPendingApplications(db, supervisorId);
      // 左连接保留没有待审申请的主管记录，用来区分空列表和无查看权限。
      if (!rows.length) fail(403, "只有部门主管可以查看本部门的入部申请。");
      return rows.flatMap(({ id, name, email, submittedAt }) =>
        id !== null && name !== null && email !== null && submittedAt !== null
          ? [{ id, name, email, submittedAt }]
          : []
      );
    },

    /** 更新审核记录和创建部门成员共用同一事务。 */
    reviewApplication(
      reviewerId: string,
      applicationId: string,
      decision: "approve" | "reject"
    ) {
      return db.transaction(async (tx) => {
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

        const application = await selectDepartmentApplicationForReview(
          tx,
          departmentId,
          applicationId
        );
        if (!application) {
          fail(
            404,
            currentScope.scope === "company"
              ? "未找到入部申请。"
              : "未找到本部门的入部申请。"
          );
        }
        if (application.status !== "pending") {
          failOrganization("applicationAlreadyReviewed");
        }

        await requireLockedApplicant(tx, application.userId);
        if (decision === "approve") {
          await requireUnassignedAccount(tx, application.userId);
        }
        const reviewed = await updatePendingApplicationStatus(
          tx,
          departmentId,
          applicationId,
          reviewerId,
          decision === "approve" ? "approved" : "rejected"
        );
        if (!reviewed) failOrganization("applicationAlreadyReviewed");

        if (decision === "approve") {
          await addDepartmentMember(
            tx,
            departmentId,
            application.userId,
            "member"
          );
        }
        return reviewed;
      });
    },
  };
}
