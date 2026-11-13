import type {
  Customer,
  CustomerOwner,
  CustomerWriteInput,
} from "@/request/customers";

import type { CustomerFormOption } from "./channel-tag-pickers";

type Draft = {
  companyName: string;
  remark: string;
  owner: CustomerOwner | undefined;
  channels: CustomerFormOption[];
  tags: CustomerFormOption[];
};

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

function sameOptions(
  before: CustomerFormOption[],
  after: CustomerFormOption[]
) {
  if (before.length !== after.length) return false;
  const previous = new Set(optionIds(before));
  return after.every(({ id }) => previous.has(id));
}

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
