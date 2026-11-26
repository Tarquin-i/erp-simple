import type { DatabaseTransaction } from "@repo/db";
import {
  companyAdministrator,
  departmentApplication,
  organization,
  user,
} from "@repo/db/schema";
import { eq } from "drizzle-orm";

import { createAccountProvisioning } from "../../modules/identity";
import {
  seedAccounts,
  seedDepartments,
  seedPassword,
} from "./account-definitions";
import type { DepartmentKey } from "./account-definitions";

export async function seedDevelopmentAccounts(tx: DatabaseTransaction) {
  const departmentIds = new Map<DepartmentKey, string>();
  for (const { key, name } of seedDepartments) {
    const slug = `erp-local-seed-${key}`;
    const [created] = await tx
      .insert(organization)
      .values({ id: crypto.randomUUID(), name, slug })
      .onConflictDoNothing({ target: organization.slug })
      .returning({ id: organization.id });
    const [department] = created
      ? [created]
      : await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, slug))
          .limit(1);
    if (!department) throw new Error("种子部门不存在。");
    departmentIds.set(key, department.id);
  }

  const provisioning = createAccountProvisioning(tx);
  let createdAccounts = 0;
  for (const definition of seedAccounts) {
    const email = `${definition.login}@e.test`;
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (existing) continue;

    const account = await provisioning.registerAccount({
      email,
      name: definition.name,
      password: seedPassword,
    });
    if (definition.role === "company-admin") {
      await tx.insert(companyAdministrator).values({ userId: account.id });
    } else {
      const organizationId = departmentIds.get(definition.department);
      if (!organizationId) throw new Error("种子部门不存在。");
      if (definition.role === "applicant") {
        await tx
          .insert(departmentApplication)
          .values({ userId: account.id, organizationId });
      } else {
        await provisioning.addOrganizationMember({
          userId: account.id,
          organizationId,
          role: definition.role,
        });
      }
    }
    createdAccounts++;
  }

  return { createdAccounts, departmentIds };
}
