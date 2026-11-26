import {
  companyAdministrator,
  departmentApplication,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import type {
  Database,
  DatabaseTransaction,
} from "../../identity/auth/better-auth";

const pendingApplication = eq(departmentApplication.status, "pending");

const receiptColumns = {
  id: departmentApplication.id,
  departmentId: departmentApplication.organizationId,
  status: departmentApplication.status,
  submittedAt: departmentApplication.submittedAt,
};

/** 同一账号的申请与入部操作共享这把账号行锁。 */
export async function lockApplicantAccount(
  tx: DatabaseTransaction,
  userId: string
) {
  const [applicant] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update")
    .limit(1);
  return applicant;
}

export async function selectApplicantMembership(
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
  return account;
}

export async function selectPendingApplicationForAccount(
  tx: DatabaseTransaction,
  userId: string
) {
  const [pending] = await tx
    .select(receiptColumns)
    .from(departmentApplication)
    .where(and(eq(departmentApplication.userId, userId), pendingApplication))
    .limit(1);
  return pending;
}

export async function departmentExists(
  tx: DatabaseTransaction,
  departmentId: string
) {
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId))
    .limit(1);
  return Boolean(department);
}

export async function insertDepartmentApplication(
  tx: DatabaseTransaction,
  userId: string,
  departmentId: string
) {
  const [application] = await tx
    .insert(departmentApplication)
    .values({ userId, organizationId: departmentId })
    .returning(receiptColumns);
  return application;
}

export function selectSupervisorPendingApplications(
  db: Database,
  supervisorId: string
) {
  return db
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
        pendingApplication
      )
    )
    .leftJoin(user, eq(user.id, departmentApplication.userId))
    .where(and(eq(member.userId, supervisorId), eq(member.role, "supervisor")))
    .orderBy(
      asc(departmentApplication.submittedAt),
      asc(departmentApplication.id)
    );
}

export async function selectApplicationReviewer(
  tx: DatabaseTransaction,
  userId: string
) {
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
  return reviewer;
}

export async function selectApplicationDepartment(
  tx: DatabaseTransaction,
  applicationId: string
) {
  const [application] = await tx
    .select({ departmentId: departmentApplication.organizationId })
    .from(departmentApplication)
    .where(eq(departmentApplication.id, applicationId))
    .limit(1);
  return application;
}

export async function selectDepartmentApplicationForReview(
  tx: DatabaseTransaction,
  departmentId: string,
  applicationId: string
) {
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
  return application;
}

export async function updatePendingApplicationStatus(
  tx: DatabaseTransaction,
  departmentId: string,
  applicationId: string,
  reviewerId: string,
  status: "approved" | "rejected"
) {
  const [reviewed] = await tx
    .update(departmentApplication)
    .set({
      status,
      reviewedAt: new Date(),
      reviewedByUserId: reviewerId,
    })
    .where(
      and(
        eq(departmentApplication.id, applicationId),
        eq(departmentApplication.organizationId, departmentId),
        pendingApplication
      )
    )
    .returning({
      id: departmentApplication.id,
      status: departmentApplication.status,
    });
  return reviewed;
}

/** 任命未入部的候选人时，只通过该账号在目标部门的待审申请。 */
export async function approvePendingApplicationForMember(
  tx: DatabaseTransaction,
  departmentId: string,
  userId: string,
  reviewerId: string
) {
  const [application] = await tx
    .update(departmentApplication)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewedByUserId: reviewerId,
    })
    .where(
      and(
        eq(departmentApplication.userId, userId),
        eq(departmentApplication.organizationId, departmentId),
        pendingApplication
      )
    )
    .returning({ id: departmentApplication.id });
  return application;
}

export function selectPendingDepartmentApplicants(tx: DatabaseTransaction) {
  return tx
    .select({
      departmentId: departmentApplication.organizationId,
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        applicationId: departmentApplication.id,
      },
    })
    .from(departmentApplication)
    .innerJoin(user, eq(departmentApplication.userId, user.id))
    .leftJoin(member, eq(member.userId, user.id))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(
      and(
        pendingApplication,
        isNull(member.id),
        isNull(companyAdministrator.userId)
      )
    )
    .orderBy(asc(user.name), asc(user.email), asc(user.id));
}
