import type {
  Customer,
  CustomerOwner,
  CustomerWriteInput,
} from "@/request/customers";

import type { CustomerFormOption } from "./channel-tag-selectors";

export type Draft = {
  companyName: string;
  remark: string;
  owner: CustomerOwner | undefined;
  channels: CustomerFormOption[];
  tags: CustomerFormOption[];
};

/**
 * 将客户资料转换为表单初始值，统一渠道和标签的选项结构。
 * @param customer 编辑时传客户详情，新建时传 `undefined`。
 * @param owner 表单使用的初始业务员，可由详情或当前账号提供。
 * @returns 可直接填入表单的草稿。缺失的文本用空字符串，缺失的渠道和标签用空数组。
 */
export function customerDraft(
  customer: Customer | undefined,
  owner?: CustomerOwner
): Draft {
  return {
    companyName: customer?.companyName ?? "",
    remark: customer?.remark ?? "",
    owner,
    channels:
      customer?.channels.map(({ code, name }) => ({ id: code, name })) ?? [],
    tags: customer?.tags.map(({ id, name }) => ({ id, name })) ?? [],
  };
}

function optionIds(options: CustomerFormOption[]) {
  return options.map(({ id }) => id);
}

/**
 * 按选项 ID 比较两组已去重的选择，忽略排列顺序和显示名称。
 * @param before 原有选项。
 * @param after 当前选项。
 * @returns 两组包含相同 ID 时为 `true`。
 */
export function sameOptions(
  before: CustomerFormOption[],
  after: CustomerFormOption[]
) {
  if (before.length !== after.length) return false;
  const previous = new Set(optionIds(before));
  return after.every(({ id }) => previous.has(id));
}

/**
 * 生成只包含改动字段的客户写入参数。
 * @param initial 打开表单时的初始草稿。
 * @param draft 当前表单草稿。
 * @returns 变更字段。空数组清空对应的渠道或标签，`null` 清空备注，省略字段保留原值。
 */
export function getChangedFields(
  initial: Draft,
  draft: Draft
): CustomerWriteInput {
  const companyName = draft.companyName.trim();
  const remark = draft.remark.trim();

  return {
    ...(companyName !== initial.companyName.trim() ? { companyName } : {}),
    ...(remark !== initial.remark.trim() ? { remark: remark || null } : {}),
    ...(draft.owner && draft.owner.id !== initial.owner?.id
      ? { ownerUserId: draft.owner.id }
      : {}),
    ...(!sameOptions(initial.channels, draft.channels)
      ? { channelCodes: optionIds(draft.channels) }
      : {}),
    ...(!sameOptions(initial.tags, draft.tags)
      ? { tagIds: optionIds(draft.tags) }
      : {}),
  };
}
