import { DEFAULT_PHONE_COUNTRY, normalizeMobilePhone } from "@repo/phone";

import { CustomerApiError } from "@/request/customers";
import type {
  CustomerContact,
  CustomerContactMethod,
  CustomerContactMethodInput,
} from "@/request/customers";

import { contactMethodLabels } from "./method-labels";
import {
  contactValueError,
  isPhoneMethod,
  sameContactValue,
} from "./method-value";
import type { ContactChange } from "./mutations";
import { readPhoneDraft } from "./phone-number-input";

export type ContactConflict = {
  change: Exclude<ContactChange, { kind: "create" }>;
  draftChange: Exclude<ContactChange, { kind: "create" }>;
  latest: CustomerContact;
  primaryAlreadyApplied?: boolean;
  phoneValueAlreadyApplied?: boolean;
};

/**
 * 从版本冲突响应中提取当前联系人的最新快照。
 * @param error 联系方式请求捕获的错误。
 * @param contactId 本次操作的联系人 ID。
 * @returns ID 匹配且含数值版本和联系方式数组的快照，其他情况返回 `undefined`。
 */
export function latestContact(error: unknown, contactId: string) {
  if (
    !(error instanceof CustomerApiError) ||
    (error.code !== "version_conflict" &&
      error.code !== "contact_method_not_found")
  )
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

function phoneCountryForOverwrite(method: CustomerContactMethod) {
  if (isPhoneMethod(method.type))
    return readPhoneDraft(method.value, DEFAULT_PHONE_COUNTRY).number?.country;
}

/** 先解析覆盖时拟保存的手机号，使弹窗与发送的请求使用同一个区号。 */
export function normalizeContactOverwrite(
  change: ContactConflict["change"],
  current: CustomerContactMethod | undefined
): ContactConflict["change"] {
  if (
    change.kind !== "edit" ||
    !current ||
    change.fields.value === undefined ||
    !isPhoneMethod(change.fields.type ?? current.type)
  )
    return change;

  const value = normalizeMobilePhone(
    change.fields.value,
    phoneCountryForOverwrite(current)
  );
  return value === undefined
    ? change
    : { ...change, fields: { ...change.fields, value } };
}

/** 判断最新资料与待保存的字段能否组合成有效的联系方式。 */
export function contactOverwriteError({ change, latest }: ContactConflict) {
  if (change.kind !== "edit") return;
  const method = latest.methods.find((item) => item.id === change.methodId);
  if (!method) return "该联系方式已被删除。";
  const { type, value, isPrimary } = change.fields;
  if (
    type !== undefined &&
    latest.methods.some((item) => item.id !== method.id && item.type === type)
  ) {
    return `该联系人已有${contactMethodLabels[type]}，请重新选择可用的联系方式。`;
  }
  if (isPrimary === false && method.isPrimary && latest.methods.length === 1) {
    return "唯一的联系方式必须保留为主要联系方式，可以返回表单修改其他字段。";
  }
  if (type !== undefined || value !== undefined)
    return contactValueError(
      type ?? method.type,
      value ?? method.value,
      phoneCountryForOverwrite(method)
    );
}

function methodLabel(method: CustomerContactMethodInput) {
  return `${contactMethodLabels[method.type]} · ${method.value}`;
}

function primaryDifference(
  current: CustomerContactMethodInput | undefined,
  proposed: CustomerContactMethodInput | undefined
) {
  return {
    label: "主要联系方式",
    current: current ? methodLabel(current) : "无主要联系方式",
    proposed: proposed ? methodLabel(proposed) : "无主要联系方式",
  };
}

/**
 * 生成联系人冲突弹窗中的当前值与拟提交值，包含主要联系方式的变化。
 * @param conflict 包含待执行的操作和服务端最新联系人快照。
 * @returns 按操作生成的对比行。待编辑的联系方式已不存在时返回空数组。
 */
export function conflictDifferences({
  change,
  latest,
  primaryAlreadyApplied,
  phoneValueAlreadyApplied,
}: ContactConflict) {
  const primary = latest.methods.find((method) => method.isPrimary);
  // 服务端已经按主要项、创建时间和 ID 排序，递补时取首条其他记录。
  const replacementFor = (id: string) =>
    latest.methods.find((method) => method.id !== id);

  switch (change.kind) {
    case "rename":
      return [
        { label: "联系人姓名", current: latest.name, proposed: change.name },
      ];
    case "add": {
      const differences = [
        {
          label: contactMethodLabels[change.method.type],
          current: "未添加",
          proposed: change.method.value,
        },
      ];
      if (change.method.isPrimary || !primary) {
        differences.push(primaryDifference(primary, change.method));
      }
      return differences;
    }
    case "delete": {
      const method = latest.methods.find(
        (item) => item.id === change.method.id
      );
      const differences = [
        {
          label: "待删除的联系方式",
          current: method ? methodLabel(method) : "已删除",
          proposed: "删除该联系方式",
        },
      ];
      if (method?.isPrimary) {
        differences.push(primaryDifference(method, replacementFor(method.id)));
      }
      return differences;
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
      if (
        !phoneValueAlreadyApplied &&
        (change.fields.value !== undefined ||
          !sameContactValue(
            current.type === original.type ? current.type : "",
            current.value,
            original.value
          ))
      )
        differences.push({
          label: "联系信息",
          current: current.value,
          proposed: change.fields.value ?? "保留当前联系信息",
        });
      if (change.fields.isPrimary === true && !current.isPrimary) {
        differences.push(
          primaryDifference(primary, {
            type: change.fields.type ?? current.type,
            value: change.fields.value ?? current.value,
          })
        );
      }
      if (change.fields.isPrimary === false && current.isPrimary) {
        const replacement = replacementFor(current.id);
        differences.push(
          replacement
            ? primaryDifference(current, replacement)
            : {
                label: "主要联系方式",
                current: methodLabel(current),
                proposed: "无法取消唯一的主要联系方式",
              }
        );
      }
      if (
        !primaryAlreadyApplied &&
        change.fields.isPrimary === undefined &&
        current.isPrimary &&
        (change.fields.type !== undefined || change.fields.value !== undefined)
      ) {
        differences.push(
          primaryDifference(current, {
            type: change.fields.type ?? current.type,
            value: change.fields.value ?? current.value,
          })
        );
      }
      return differences;
    }
  }
}
