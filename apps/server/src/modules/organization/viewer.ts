import {
  companyAdministrator,
  departmentApplication,
  member,
  organization,
  user,
} from "@repo/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { database } from "../identity/auth/better-auth";
import { fail } from "./errors";

const requestedDepartment = alias(organization, "requested_department");

/**
 * 查询当前账号在工作台中的身份及入部状态，公司管理员身份优先于部门角色。
 * @param accountId 当前登录账号的 ID。
 * @returns 账号资料、角色、所属部门和最近一次入部申请。缺少部门或申请时，对应字段为 `null`。
 * @throws 账号不存在时抛出 HTTP 401 异常。
 */
export async function getViewer(accountId: string) {
  const latestApplication = database.db
    .select({
      id: departmentApplication.id,
      status: departmentApplication.status,
      submittedAt: departmentApplication.submittedAt,
      reviewedAt: departmentApplication.reviewedAt,
      departmentId: departmentApplication.organizationId,
    })
    .from(departmentApplication)
    .where(eq(departmentApplication.userId, user.id))
    .orderBy(
      desc(departmentApplication.submittedAt),
      desc(departmentApplication.id)
    )
    .limit(1)
    .as("latest_application");

  // 在同一条查询中读取部门身份和申请状态，避免跨快照读到不一致的结果。
  const [viewer] = await database.db
    .select({
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      adminId: companyAdministrator.userId,
      memberRole: member.role,
      department: { id: organization.id, name: organization.name },
      application: {
        id: latestApplication.id,
        status: latestApplication.status,
        submittedAt: latestApplication.submittedAt,
        reviewedAt: latestApplication.reviewedAt,
      },
      requestedDepartment: {
        id: requestedDepartment.id,
        name: requestedDepartment.name,
      },
    })
    .from(user)
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .leftJoin(member, eq(member.userId, user.id))
    .leftJoin(organization, eq(organization.id, member.organizationId))
    .leftJoinLateral(latestApplication, sql`true`)
    .leftJoin(
      requestedDepartment,
      eq(requestedDepartment.id, latestApplication.departmentId)
    )
    .where(eq(user.id, accountId))
    .limit(1);

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
}
