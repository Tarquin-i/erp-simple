import type { Database } from "../../identity/auth/better-auth";
import { fail } from "../../../errors";
import { selectViewer } from "../persistence/viewer";

export function createViewerUseCases(db: Database) {
  return {
    /** 管理员身份优先，缺少部门或申请时保留 null。 */
    async getViewer(accountId: string) {
      const viewer = await selectViewer(db, accountId);
      if (!viewer) fail(401, "请先登录。");

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
