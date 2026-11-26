import { fail } from "../../../errors";

const organizationErrors = {
  departmentAdministrationForbidden: [403, "只有公司管理员可以管理部门。"],
  departmentNameConflict: [409, "该部门名称已存在。"],
  applicationAlreadyReviewed: [409, "该申请已处理。"],
} as const;

export function failOrganization(code: keyof typeof organizationErrors): never {
  const [status, message] = organizationErrors[code];
  return fail(status, message);
}
