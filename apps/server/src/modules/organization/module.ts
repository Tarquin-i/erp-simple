import type { Database } from "@repo/db";
import { readAccountRecordAccess } from "./application/account-record-access";
import { createDepartmentApplicationUseCases } from "./application/department-applications";
import { createDepartmentUseCases } from "./application/departments";
import { createMemberUseCases } from "./application/members";
import { createViewerUseCases } from "./application/viewer";

export function createOrganizationModule(db: Database) {
  return {
    departments: createDepartmentUseCases(db),
    members: createMemberUseCases(db),
    departmentApplications: createDepartmentApplicationUseCases(db),
    viewer: createViewerUseCases(db),
    readAccountRecordAccess: (userId: string) =>
      readAccountRecordAccess(db, userId),
  };
}

export type OrganizationModule = ReturnType<typeof createOrganizationModule>;
