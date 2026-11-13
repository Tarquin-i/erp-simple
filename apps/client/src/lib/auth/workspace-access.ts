import type { Viewer } from "@/request/organization";

/**
 * 判断当前账号能否进入工作台，用于前端路由跳转。
 * @param viewer 后端返回的账号角色和部门信息。
 * @returns 公司管理员，或已有所属部门的员工与主管，返回 `true`。
 */
export function canEnterWorkspace(viewer: Viewer) {
  return (
    viewer.role === "company-admin" ||
    (viewer.department !== null &&
      (viewer.role === "member" || viewer.role === "supervisor"))
  );
}
