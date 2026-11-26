import type { Database } from "@repo/db";
import { withBusinessReadSnapshot } from "../../business/access";
import type { BusinessAccess } from "../../business/access";
import {
  findOwnerDepartment,
  findVisibleCustomerDepartment,
  selectAssignableOwners,
  selectVisibleOwners,
} from "../persistence/owner-options";
import { createCustomerError } from "./errors";

export function createOwnerOptionUseCases(db: Database) {
  return {
    listVisibleOwners: (access: BusinessAccess) =>
      withBusinessReadSnapshot(access.userId, selectVisibleOwners, db),

    listAssignableOwners(
      access: BusinessAccess,
      {
        customerId,
        departmentId,
      }: { customerId?: string; departmentId?: string }
    ) {
      return withBusinessReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          if (departmentId !== undefined) {
            if (freshAccess.scope !== "company") {
              throw createCustomerError("ownerDepartmentForbidden");
            }
            if (!(await findOwnerDepartment(tx, departmentId))) {
              throw createCustomerError("ownerDepartmentNotFound");
            }
            return selectAssignableOwners(tx, departmentId);
          }

          if (customerId === undefined) {
            return freshAccess.scope === "department"
              ? selectAssignableOwners(tx, freshAccess.departmentId)
              : [];
          }

          const record = await findVisibleCustomerDepartment(
            tx,
            freshAccess,
            customerId
          );
          if (!record) throw createCustomerError("profileNotFound");
          return freshAccess.scope === "own"
            ? []
            : selectAssignableOwners(tx, record.departmentId);
        },
        db
      );
    },
  };
}
