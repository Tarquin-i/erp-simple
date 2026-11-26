import type { Database } from "../../identity/auth/better-auth";
import { fail } from "../../../errors";
import { approvePendingApplicationForMember } from "../persistence/department-applications";
import { lockDepartment } from "../persistence/departments";
import {
  addDepartmentMember,
  demoteDepartmentSupervisor,
  findCompanyAdministrator,
  findDepartmentMembership,
  lockAccountByEmail,
  promoteDepartmentMember,
} from "../persistence/members";

export function createMemberUseCases(db: Database) {
  return {
    /** 在同一事务批准候选人入部、降级原主管并任命新主管。 */
    appointSupervisor(departmentId: string, email: string, adminId: string) {
      return db.transaction(async (tx) => {
        await lockDepartment(tx, departmentId);

        const candidate = await lockAccountByEmail(tx, email);
        if (!candidate) fail(404, "未找到这个邮箱对应的注册账号。");
        if (await findCompanyAdministrator(tx, candidate.id)) {
          fail(409, "公司管理员使用全局角色，主管须是部门员工。");
        }

        const membership = await findDepartmentMembership(tx, candidate.id);
        if (membership && membership.organizationId !== departmentId) {
          fail(409, "此员工已加入其他部门。");
        }

        const result = {
          departmentId,
          userId: candidate.id,
          role: "supervisor" as const,
        };
        if (membership?.role === "supervisor") return result;

        // 候选人尚未入部时，在任命事务中同时通过其待审申请。
        if (!membership) {
          const application = await approvePendingApplicationForMember(
            tx,
            departmentId,
            candidate.id,
            adminId
          );
          if (!application) fail(409, "请让这名员工先申请加入该部门。");
        }

        await demoteDepartmentSupervisor(tx, departmentId);
        if (membership) {
          await promoteDepartmentMember(tx, membership.id);
        } else {
          await addDepartmentMember(
            tx,
            departmentId,
            candidate.id,
            "supervisor"
          );
        }
        return result;
      });
    },
  };
}
