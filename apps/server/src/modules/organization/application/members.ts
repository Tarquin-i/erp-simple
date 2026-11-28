import type { Database } from "@repo/db";
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
import { failOrganization } from "./errors";

export function createMemberUseCases(db: Database) {
  return {
    /** 在同一事务批准候选人入部、降级原主管并任命新主管。 */
    appointSupervisor(departmentId: string, email: string, adminId: string) {
      return db.transaction(async (tx) => {
        await lockDepartment(tx, departmentId);

        const candidate = await lockAccountByEmail(tx, email);
        if (!candidate) failOrganization("supervisorCandidateNotFound");
        if (await findCompanyAdministrator(tx, candidate.id)) {
          failOrganization("supervisorCandidateIsAdministrator");
        }

        const membership = await findDepartmentMembership(tx, candidate.id);
        if (membership && membership.organizationId !== departmentId) {
          failOrganization("supervisorCandidateInOtherDepartment");
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
          if (!application) {
            failOrganization("supervisorCandidateApplicationRequired");
          }
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
