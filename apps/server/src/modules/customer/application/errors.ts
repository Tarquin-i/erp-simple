import { ApplicationError } from "../../../errors";

const customerErrors = {
  ownerDepartmentForbidden: {
    status: 403,
    message: "只有公司管理员可指定部门查询业务员。",
  },
  ownerDepartmentNotFound: { status: 404, message: "该部门不存在。" },
  profileNotFound: { status: 404, message: "客户不存在。" },
  profileNameExists: {
    status: 409,
    code: "duplicate_customer",
    message: "该部门已有同名客户。",
  },
  profileDepartmentForbidden: {
    status: 403,
    message: "只有公司管理员可指定客户所属部门。",
  },
  contactNotFound: { status: 404, message: "联系人不存在。" },
  contactDuplicateEmail: {
    status: 409,
    message: "同一联系人不能重复添加相同邮箱。",
  },
  contactDuplicateType: {
    status: 409,
    message: "除邮箱外，同一联系人每种联系方式最多一条。",
  },
  contactMultiplePrimary: {
    status: 400,
    message: "每个联系人只能有一个主要联系方式。",
  },
  contactPrimaryRequired: { status: 400, message: "请选择一个主要联系方式。" },
  contactOnlyMethodPrimary: {
    status: 400,
    message: "唯一的联系方式必须保留为主要联系方式。",
  },
  tagNotFound: { status: 404, message: "标签不存在。" },
  tagNameExists: {
    status: 409,
    code: "tag_name_exists",
    message: "标签名称已存在。",
  },
  tagColorForbidden: {
    status: 403,
    message: "仅公司管理员可以修改共享标签颜色。",
  },
  tagColorConflict: {
    status: 409,
    code: "tag_color_conflict",
    message: "标签颜色已被更新，请查看当前颜色后再保存。",
  },
} as const;

export function createCustomerError(
  reason: keyof typeof customerErrors,
  current?: unknown
) {
  const definition = customerErrors[reason];
  return new ApplicationError(definition.status, definition.message, {
    code: "code" in definition ? definition.code : undefined,
    current,
  });
}
