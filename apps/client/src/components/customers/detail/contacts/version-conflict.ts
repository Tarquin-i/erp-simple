import { CustomerApiError } from "@/request/customers";
import type { CustomerContact } from "@/request/customers";

import { contactMethodLabels } from "./method-labels";
import type { ContactChange } from "./mutations";

export type ContactConflict = {
  change: Exclude<ContactChange, { kind: "create" }>;
  latest: CustomerContact;
};

/**
 * 从版本冲突响应中提取当前联系人的最新快照。
 * @param error 联系方式请求捕获的错误。
 * @param contactId 本次操作的联系人 ID。
 * @returns ID 匹配且含数值版本和联系方式数组的快照，其他情况返回 `undefined`。
 */
export function latestContact(error: unknown, contactId: string) {
  if (!(error instanceof CustomerApiError) || error.code !== "version_conflict")
    return;
  const current = error.current;
  if (
    current &&
    typeof current === "object" &&
    "id" in current &&
    current.id === contactId &&
    "version" in current &&
    typeof current.version === "number" &&
    "methods" in current &&
    Array.isArray(current.methods)
  )
    return current as CustomerContact;
}

/**
 * 生成联系人冲突弹窗中的当前值与拟提交值，标出会保留的服务端字段。
 * @param conflict 包含待执行的操作和服务端最新联系人快照。
 * @returns 按操作生成的对比行。待编辑的联系方式已不存在时返回空数组。
 */
export function conflictDifferences({ change, latest }: ContactConflict) {
  switch (change.kind) {
    case "rename":
      return [
        { label: "联系人姓名", current: latest.name, proposed: change.name },
      ];
    case "add":
      return [
        {
          label: contactMethodLabels[change.method.type],
          current: "未添加",
          proposed: change.method.value,
        },
      ];
    case "delete": {
      const method = latest.methods.find(
        (item) => item.id === change.method.id
      );
      return [
        {
          label: "待删除的联系方式",
          current: method
            ? `${contactMethodLabels[method.type]} · ${method.value}`
            : "已删除",
          proposed: "删除该联系方式",
        },
      ];
    }
    case "edit": {
      const current = latest.methods.find(
        (item) => item.id === change.methodId
      );
      if (!current) return [];
      const original =
        change.contact.methods.find((item) => item.id === change.methodId) ??
        current;
      const differences: {
        label: string;
        current: string;
        proposed: string;
      }[] = [];
      if (latest.name !== change.contact.name)
        differences.push({
          label: "联系人姓名",
          current: latest.name,
          proposed: "保留当前姓名",
        });
      if (change.fields.type !== undefined || current.type !== original.type)
        differences.push({
          label: "联系方式",
          current:
            current.type === original.type
              ? contactMethodLabels[current.type]
              : `${contactMethodLabels[current.type]}（原为${contactMethodLabels[original.type]}）`,
          proposed:
            change.fields.type === undefined
              ? "保留当前方式"
              : contactMethodLabels[change.fields.type],
        });
      if (change.fields.value !== undefined || current.value !== original.value)
        differences.push({
          label: "联系信息",
          current: current.value,
          proposed: change.fields.value ?? "保留当前联系信息",
        });
      if (
        change.fields.isPrimary !== undefined ||
        current.isPrimary !== original.isPrimary
      )
        differences.push({
          label: "主要联系方式",
          current: current.isPrimary ? "是" : "否",
          proposed:
            change.fields.isPrimary === undefined
              ? "保留当前设置"
              : change.fields.isPrimary
                ? "是"
                : "否",
        });
      return differences;
    }
  }
}
