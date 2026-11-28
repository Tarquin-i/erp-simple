import { ModuleError } from "../../shared/application-error";

const customerErrorMessages = {
  ownerDepartmentForbidden: "只有公司管理员可指定部门查询业务员。",
  ownerDepartmentNotFound: "该部门不存在。",
  profileNotFound: "客户不存在。",
  profileNameExists: "该部门已有同名客户。",
  profileDepartmentForbidden: "只有公司管理员可指定客户所属部门。",
  profileTagsNotAssignable: "所选标签不存在或不属于该客户所在部门。",
  profileChannelNotFound: "所选渠道不存在。",
  profileTagNotFound: "所选标签不存在。",
  profileDepartmentRequired: "请选择客户所属部门。",
  profileOwnerRequired: "请选择业务员。",
  profileIdempotencyConflict: "该提交 ID 已用于不同的客户资料。",
  profileCreateDepartmentForbidden: "只能在当前所属部门新建客户。",
  profileCreateOwnerForbidden: "只有部门主管或公司管理员可在新建时指定业务员。",
  profileChangeOwnerForbidden: "只有部门主管或公司管理员可更换业务员。",
  profileNumberConflict: "客户编号生成冲突，请重试。",
  profileConcurrentUpdate: "客户资料有并发更新，请重试。",
  profileActiveProducts: "该客户还有未归档产品，请先归档产品。",
  profileWriteNotFound: "客户不存在。",
  profileOwnerNotAssignable: "请选择客户所属部门的成员作为业务员。",
  versionConflict: "资料已被更新，请查看最新资料后确认是否覆盖。",
  contactNotFound: "联系人不存在。",
  contactIdempotencyConflict: "该提交 ID 已用于不同的联系人内容。",
  contactMethodNotFound: "联系方式不存在。",
  contactMethodMissing: "联系方式不存在。",
  contactRestoreTypeConflict: "旧联系方式类型已被其他记录占用，无法写回。",
  contactRestorePrimaryMissing: "原主要联系方式已被删除，无法写回旧值。",
  contactDuplicateEmail: "同一联系人不能重复添加相同邮箱。",
  contactDuplicateType: "除邮箱外，同一联系人每种联系方式最多一条。",
  contactMultiplePrimary: "每个联系人只能有一个主要联系方式。",
  contactPrimaryRequired: "请选择一个主要联系方式。",
  contactOnlyMethodPrimary: "唯一的联系方式必须保留为主要联系方式。",
  tagNotFound: "标签不存在。",
  tagNameExists: "标签名称已存在。",
  tagColorConflict: "标签颜色已被更新，请查看当前颜色后再保存。",
  tagDepartmentForbidden: "只能访问当前所属部门的标签。",
  tagDepartmentRequired: "请选择标签所属部门。",
  tagConflict: "标签已被更新，请查看最新资料后再试。",
} as const;

export type CustomerErrorReason =
  | keyof typeof customerErrorMessages
  | "contactMethodsInvalid"
  | "contactMethodValueInvalid"
  | "tagInUse";

export function createCustomerError(
  reason: keyof typeof customerErrorMessages,
  current?: unknown
) {
  return new ModuleError(
    "customer",
    reason,
    customerErrorMessages[reason],
    current
  );
}

export function createCustomerTagInUseError(references: number) {
  return new ModuleError(
    "customer",
    "tagInUse",
    `此标签已被 ${references} 条记录引用，请先解除关联再删除。`,
    { references }
  );
}
