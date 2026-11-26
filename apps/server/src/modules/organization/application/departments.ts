import type { Database } from "../../identity/auth/better-auth";
import { selectPendingDepartmentApplicants } from "../persistence/department-applications";
import {
  insertDepartment,
  selectDepartments,
} from "../persistence/departments";
import {
  findCompanyAdministrator,
  listRosterMembers,
} from "../persistence/members";
import { failOrganization } from "./errors";

export function createDepartmentUseCases(db: Database) {
  return {
    listDepartments() {
      return selectDepartments(db);
    },
    async requireCompanyAdministrator(accountId: string) {
      const admin = await findCompanyAdministrator(db, accountId);
      if (!admin) failOrganization("departmentAdministrationForbidden");
      return admin.userId;
    },
    async createDepartment(name: string) {
      // 用 NFKC 和小写统一名称后编码，使同名重试命中同一个唯一键。
      const slug = `department-${Buffer.from(name.normalize("NFKC").toLowerCase()).toString("base64url")}`;
      const department = await insertDepartment(db, name, slug);
      if (!department) failOrganization("departmentNameConflict");
      return department;
    },
    /** 在同一个只读快照内汇总部门、成员和待审申请。 */
    listDepartmentRoster() {
      return db.transaction(
        async (tx) => {
          const departments = await selectDepartments(tx);
          const memberships = await listRosterMembers(tx);
          const applications = await selectPendingDepartmentApplicants(tx);
          const roster = new Map(
            departments.map((department) => [
              department.id,
              {
                ...department,
                members: [] as (typeof memberships)[number]["account"][],
                pendingApplicants:
                  [] as (typeof applications)[number]["account"][],
              },
            ])
          );
          for (const { departmentId, account } of memberships) {
            roster.get(departmentId)?.members.push(account);
          }
          for (const { departmentId, account } of applications) {
            roster.get(departmentId)?.pendingApplicants.push(account);
          }
          return [...roster.values()];
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    },
  };
}
