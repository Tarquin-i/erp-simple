import type { Customer, CustomerWriteInput } from "@/request/customers";

import type { CustomerFormOption } from "./channel-tag-selectors";
import { customerDraft, sameOptions } from "./form-payload";
import type { Draft } from "./form-payload";

/**
 * 检查版本冲突响应是否带有当前客户及对比弹窗所需的关键字段。
 * @param value 服务端返回的 `current`，结构尚未确认。
 * @param id 正在编辑的客户 ID。
 * @returns ID 和关键字段匹配时为 `true`，供调用方使用该快照。
 */
export function isCustomerSnapshot(
  value: unknown,
  id: string
): value is Customer {
  if (!value || typeof value !== "object") return false;
  const current = value as Partial<Customer>;
  return (
    current.id === id &&
    typeof current.version === "number" &&
    typeof current.companyName === "string" &&
    typeof current.ownerUserId === "string" &&
    typeof current.ownerName === "string" &&
    Array.isArray(current.channels) &&
    Array.isArray(current.tags)
  );
}

/**
 * 对比打开表单时、本地编辑后和服务端最新的客户资料。
 * @param current 服务端返回的最新客户快照。
 * @param changes 本次提交的变更字段。
 * @param initial 打开表单时的初始草稿。
 * @param draft 当前草稿，用来显示所选业务员、渠道和标签的名称。
 * @returns 弹窗使用的差异列表。只在服务端发生变化的字段显示为「保留当前资料」。
 */
export function conflictDifferences(
  current: Customer,
  changes: CustomerWriteInput,
  initial: Draft,
  draft: Draft
) {
  const latest = customerDraft(current, {
    id: current.ownerUserId,
    name: current.ownerName,
  });
  const differences = [];
  const preserve = "保留当前资料";
  const names = (options: CustomerFormOption[]) =>
    options.map(({ name }) => name).join("、") || "无";

  if (
    changes.companyName !== undefined ||
    latest.companyName !== initial.companyName
  ) {
    differences.push({
      label: "客户名称",
      current: latest.companyName,
      proposed: changes.companyName ?? preserve,
    });
  }
  if (
    changes.channelCodes !== undefined ||
    !sameOptions(initial.channels, latest.channels)
  ) {
    differences.push({
      label: "渠道",
      current: names(latest.channels),
      proposed:
        changes.channelCodes === undefined ? preserve : names(draft.channels),
    });
  }
  if (changes.tagIds !== undefined || !sameOptions(initial.tags, latest.tags)) {
    differences.push({
      label: "标签",
      current: names(latest.tags),
      proposed: changes.tagIds === undefined ? preserve : names(draft.tags),
    });
  }
  if (
    changes.ownerUserId !== undefined ||
    current.ownerUserId !== initial.owner?.id
  ) {
    differences.push({
      label: "业务员",
      current: current.ownerName,
      proposed:
        changes.ownerUserId === undefined
          ? preserve
          : (draft.owner?.name ?? "无"),
    });
  }
  if (changes.remark !== undefined || latest.remark !== initial.remark) {
    differences.push({
      label: "备注",
      current: latest.remark || "无",
      proposed:
        changes.remark === undefined ? preserve : changes.remark || "无",
    });
  }

  return differences;
}
