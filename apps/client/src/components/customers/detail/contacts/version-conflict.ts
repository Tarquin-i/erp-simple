import { CustomerApiError } from "@/request/customers";
import type {
  ContactFormDraft,
  CustomerContact,
  CustomerContactMethodInput,
} from "@/request/customers";

import { contactMethodLabels } from "./method-labels";
import { contactMethodDuplicateError, sameContactValue } from "./method-value";
import type { ContactChange } from "./mutations";

export type ContactConflict = {
  change: Exclude<ContactChange, { kind: "create" }>;
  latest: CustomerContact;
};

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

type DraftMethod = ContactFormDraft["methods"][number];

function sameMethodContent(left: DraftMethod, right: DraftMethod) {
  return left.type === right.type && left.value === right.value;
}

function sameNewMethod(left: DraftMethod, right: DraftMethod) {
  if (left.type !== right.type) return false;
  return left.type === "email"
    ? left.value.trim().toLowerCase() === right.value.trim().toLowerCase()
    : sameContactValue(left.type, left.value, right.value);
}

function describeMethod(method: CustomerContactMethodInput) {
  return `${contactMethodLabels[method.type]} · ${method.value}`;
}

function describeMethods(methods: DraftMethod[]) {
  return methods
    .map((method) =>
      method.isPrimary
        ? `${describeMethod(method)}（主要）`
        : describeMethod(method)
    )
    .join("\n");
}

/**
 * 将草稿相对原快照的变更合入最新资料，确认后才提交。联系方式用独立 ID
 * 对齐，以免多个邮箱被误认作同一个字段。
 */
function rebaseContact(
  original: CustomerContact,
  draft: ContactFormDraft,
  latest: CustomerContact
) {
  const originalMethods = new Map(original.methods.map((row) => [row.id, row]));
  const latestIds = new Set(latest.methods.map((row) => row.id));
  const requested = new Map(
    draft.methods.flatMap((row) => (row.id ? [[row.id, row] as const] : []))
  );
  const originalPrimary = original.methods.find((row) => row.isPrimary);
  const latestPrimary = latest.methods.find((row) => row.isPrimary);
  const draftPrimary = draft.methods.find((row) => row.isPrimary);
  const changedPrimary =
    draftPrimary?.id !== originalPrimary?.id ||
    Boolean(draftPrimary && !draftPrimary.id);

  const editedMissingRow = draft.methods.some((row) => {
    if (!row.id || latestIds.has(row.id)) return false;
    const before = originalMethods.get(row.id);
    return (
      !before ||
      !sameMethodContent(row, before) ||
      (changedPrimary && row === draftPrimary)
    );
  });
  if (editedMissingRow)
    return {
      error: "你修改的联系方式已被移除，请返回表单移除该项或重新填写。",
    };

  const methods: DraftMethod[] = [];
  for (const current of latest.methods) {
    const before = originalMethods.get(current.id);
    const desired = requested.get(current.id);
    if (before && !desired) continue;
    // 类型和内容一起合并。联系方式的内容格式取决于它的类型。
    const value =
      before && desired && !sameMethodContent(desired, before)
        ? desired
        : current;
    methods.push({
      id: current.id,
      type: value.type,
      value: value.value,
      isPrimary: false,
    });
  }
  const newestRows = methods.filter(
    (row) => row.id && !originalMethods.has(row.id)
  );
  let selected: DraftMethod | undefined;
  for (const row of draft.methods) {
    if (row.id) continue;
    // 网络重试时，已有相同的新增项可以直接复用其 ID。
    const added = newestRows.find((item) => sameNewMethod(row, item));
    const next = added ?? {
      type: row.type,
      value: row.value,
      isPrimary: false,
    };
    if (!added) methods.push(next);
    if (changedPrimary && row === draftPrimary) selected = next;
  }

  for (const [index, method] of methods.entries()) {
    const error = contactMethodDuplicateError(method, methods.slice(0, index));
    if (error) return { error };
  }
  const targetId = changedPrimary ? draftPrimary?.id : latestPrimary?.id;
  selected ??= methods.find(
    (row) => targetId !== undefined && row.id === targetId
  );
  selected ??= methods.find((row) => row.id === latestPrimary?.id && row.id);
  selected ??= methods[0];

  return {
    draft: {
      name: draft.name === original.name ? latest.name : draft.name,
      methods: methods.map((row) => ({ ...row, isPrimary: row === selected })),
    },
  };
}

export function prepareContactOverwrite({ change, latest }: ContactConflict) {
  if (change.kind === "add") {
    const primary = latest.methods.find((method) => method.isPrimary);
    const differences = [
      {
        label: "新增联系方式",
        current: "未添加",
        proposed: describeMethod(change.method),
      },
    ];
    if (change.method.isPrimary || !primary)
      differences.push({
        label: "主要联系方式",
        current: primary ? describeMethod(primary) : "暂无",
        proposed: describeMethod(change.method),
      });
    return {
      change,
      differences,
      error: contactMethodDuplicateError(change.method, latest.methods),
    };
  }

  const result = rebaseContact(change.contact, change.draft, latest);
  const proposed = result.draft ?? change.draft;
  return {
    change: { ...change, draft: proposed },
    error: result.error,
    differences: [
      { label: "联系人姓名", current: latest.name, proposed: proposed.name },
      {
        label: "联系方式",
        current: describeMethods(latest.methods),
        proposed: describeMethods(proposed.methods),
      },
    ],
  };
}
