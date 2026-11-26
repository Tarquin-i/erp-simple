import type { Database, DatabaseTransaction } from "@repo/db";
import { companyAdministrator, member, user } from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createAccountProvisioning } from "../../identity";

export function listRosterMembers(tx: DatabaseTransaction) {
  return tx
    .select({
      departmentId: member.organizationId,
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
      },
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(isNull(companyAdministrator.userId))
    .orderBy(asc(user.name), asc(user.email), asc(user.id));
}

export async function findCompanyAdministrator(
  db: Database | DatabaseTransaction,
  userId: string
) {
  const [admin] = await db
    .select({ userId: companyAdministrator.userId })
    .from(companyAdministrator)
    .where(eq(companyAdministrator.userId, userId))
    .limit(1);
  return admin;
}

export async function lockAccountByEmail(
  tx: DatabaseTransaction,
  email: string
) {
  const [account] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .for("update")
    .limit(1);
  return account;
}

export async function findDepartmentMembership(
  tx: DatabaseTransaction,
  userId: string
) {
  const [membership] = await tx
    .select({
      id: member.id,
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  return membership;
}

export function demoteDepartmentSupervisor(
  tx: DatabaseTransaction,
  departmentId: string
) {
  return tx
    .update(member)
    .set({ role: "member" })
    .where(
      and(
        eq(member.organizationId, departmentId),
        eq(member.role, "supervisor")
      )
    );
}

export function promoteDepartmentMember(
  tx: DatabaseTransaction,
  membershipId: string
) {
  return tx
    .update(member)
    .set({ role: "supervisor" })
    .where(eq(member.id, membershipId));
}

export function addDepartmentMember(
  tx: DatabaseTransaction,
  departmentId: string,
  userId: string,
  role: "member" | "supervisor"
) {
  return createAccountProvisioning(tx).addOrganizationMember({
    userId,
    organizationId: departmentId,
    role,
  });
}
