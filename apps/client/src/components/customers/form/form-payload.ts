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

export function sameOptions(
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
