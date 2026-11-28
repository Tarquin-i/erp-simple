import { ModuleError } from "../../shared/application-error";

const organizationErrorMessages = {
  accountNotFound: "请先登录。",
  departmentMembershipRequired: "加入部门后才能访问业务数据。",
  departmentAdministrationForbidden: "只有公司管理员可以管理部门。",
  departmentNameConflict: "该部门名称已存在。",
  departmentNotFound: "该部门不存在。",
  applicantNotFound: "申请账号不存在。",
  applicantAlreadyAssigned: "该账号已加入部门或拥有公司管理权限。",
  applicationReviewForbidden: "只有公司管理员或部门主管可以审核入部申请。",
  applicationNotFound: "未找到入部申请。",
  departmentApplicationNotFound: "未找到本部门的入部申请。",
  pendingApplicationExists: "你已有一条待审核的入部申请。",
  applicationDepartmentNotFound: "所选部门不存在。",
  applicationListForbidden: "只有部门主管可以查看本部门的入部申请。",
  otherDepartmentReviewForbidden: "只有部门主管可以审核本部门的入部申请。",
  applicationAlreadyReviewed: "该申请已处理。",
  supervisorCandidateNotFound: "未找到这个邮箱对应的注册账号。",
  supervisorCandidateIsAdministrator:
    "公司管理员使用全局角色，主管须是部门员工。",
  supervisorCandidateInOtherDepartment: "此员工已加入其他部门。",
  supervisorCandidateApplicationRequired: "请让这名员工先申请加入该部门。",
} as const;

export type OrganizationErrorReason = keyof typeof organizationErrorMessages;

export function failOrganization(reason: OrganizationErrorReason): never {
  throw new ModuleError(
    "organization",
    reason,
    organizationErrorMessages[reason]
  );
}
