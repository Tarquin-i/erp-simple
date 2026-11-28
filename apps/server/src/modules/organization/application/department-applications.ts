import type { Database, DatabaseTransaction } from "@repo/db";
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
  if (!(await lockApplicantAccount(tx, userId))) {
    failOrganization("applicantNotFound");
  }
}

async function requireUnassignedAccount(
  tx: DatabaseTransaction,
  userId: string
) {
  const account = await selectApplicantMembership(tx, userId);
  if (account?.memberId || account?.adminId) {
    failOrganization("applicantAlreadyAssigned");
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
  failOrganization("applicationReviewForbidden");
}

async function requireApplicationDepartment(
  tx: DatabaseTransaction,
  applicationId: string
) {
  const application = await selectApplicationDepartment(tx, applicationId);
  if (!application) failOrganization("applicationNotFound");
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
            failOrganization("pendingApplicationExists");
          }
          return { application: pending, created: false };
        }

        if (!(await departmentExists(tx, departmentId))) {
          failOrganization("applicationDepartmentNotFound");
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
      if (!rows.length) failOrganization("applicationListForbidden");
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
          failOrganization("otherDepartmentReviewForbidden");
        }

        const application = await selectDepartmentApplicationForReview(
          tx,
          departmentId,
          applicationId
        );
        if (!application) {
          failOrganization(
            currentScope.scope === "company"
              ? "applicationNotFound"
              : "departmentApplicationNotFound"
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
