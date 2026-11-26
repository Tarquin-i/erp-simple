import type { DatabaseTransaction } from "@repo/db";
import {
  companyAdministrator,
  customer,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { recordScopeWhere } from "../../organization";
import type { AccountRecordAccess } from "../../organization";

// 列表筛选项取自当前可见客户的负责人。
export function selectVisibleOwners(
  tx: DatabaseTransaction,
  access: AccountRecordAccess
) {
  return tx
    .selectDistinct({ id: user.id, name: user.name })
    .from(customer)
    .innerJoin(user, eq(user.id, customer.ownerUserId))
    .where(
      and(eq(customer.status, "active"), recordScopeWhere(access, customer))
    )
    .orderBy(asc(user.name), asc(user.id));
}

// 负责人候选和实际写入校验使用同一套部门成员条件。
export function selectAssignableOwners(
  tx: DatabaseTransaction,
  departmentId: string,
  ownerUserId?: string
) {
  return tx
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(
      and(
        eq(member.organizationId, departmentId),
        isNull(companyAdministrator.userId),
        ownerUserId === undefined ? undefined : eq(member.userId, ownerUserId)
      )
    )
    .orderBy(asc(user.name), asc(user.id));
}

export async function findOwnerDepartment(
  tx: DatabaseTransaction,
  departmentId: string
) {
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId));
  return department;
}

export async function findVisibleCustomerDepartment(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  customerId: string
) {
  const [record] = await tx
    .select({ departmentId: customer.departmentId })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.status, "active"),
        recordScopeWhere(access, customer)
      )
    );
  return record;
}
