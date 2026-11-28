import type { Database } from "@repo/db";
import { selectViewer } from "../persistence/viewer";
import { failOrganization } from "./errors";

export function createViewerUseCases(db: Database) {
  return {
    /** 管理员身份优先，缺少部门或申请时保留 null。 */
    async getViewer(accountId: string) {
      const viewer = await selectViewer(db, accountId);
      if (!viewer) failOrganization("accountNotFound");

      const { application } = viewer;
      return {
        account: viewer.account,
        role: viewer.adminId
          ? ("company-admin" as const)
          : (viewer.memberRole ?? "applicant"),
        department: viewer.department,
        application:
          application && viewer.requestedDepartment
            ? { ...application, department: viewer.requestedDepartment }
            : null,
      };
    },
  };
}
