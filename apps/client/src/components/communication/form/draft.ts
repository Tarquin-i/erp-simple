import type { PickerOption } from "@/components/shared/option-pickers";
import { sameOptions } from "@/components/customers/form/form-payload";
import type {
  Communication,
  CommunicationWriteInput,
} from "@/request/communication";
import type { CustomerOwner } from "@/request/customers";

export type CommunicationDraft = {
  title: string;
  summary: string;
  owner?: CustomerOwner;
  tags: PickerOption[];
};

type EditableFields = Omit<CommunicationWriteInput, "status">;

/** 从沟通记录生成表单数据。新建时使用默认业务员和空白内容。 */
export function toDraft(
  record?: Communication,
  owner?: CustomerOwner
): CommunicationDraft {
  return {
    title: record?.title ?? "",
    summary: record?.summary ?? "",
    owner: record ? { id: record.ownerUserId, name: record.ownerName } : owner,
    tags: record?.tags ?? [],
  };
}

/** 取得实际修改的字段，防止覆盖别人刚保存的其他资料。 */
export function getChanges(
  before: CommunicationDraft,
  after: CommunicationDraft
): EditableFields {
  const title = after.title.trim();
  const summary = after.summary.trim();
  return {
    ...(title !== before.title.trim() ? { title } : {}),
    ...(summary !== before.summary.trim() ? { summary } : {}),
    ...(after.owner && after.owner.id !== before.owner?.id
      ? { ownerUserId: after.owner.id }
      : {}),
    ...(!sameOptions(before.tags, after.tags)
      ? { tagIds: after.tags.map(({ id }) => id) }
      : {}),
  };
}

/** 用最新版本更新未修改字段，保留本次已经提交的草稿。 */
export function rebaseDraft(
  latest: CommunicationDraft,
  draft: CommunicationDraft,
  changes: EditableFields
) {
  return {
    title: changes.title === undefined ? latest.title : draft.title,
    summary: changes.summary === undefined ? latest.summary : draft.summary,
    owner: changes.ownerUserId === undefined ? latest.owner : draft.owner,
    tags: changes.tagIds === undefined ? latest.tags : draft.tags,
  };
}

/** 比较服务端最新数据和用户仍待提交的内容。已相同的字段不展示。 */
export function getDifferences(
  latest: CommunicationDraft,
  draft: CommunicationDraft
) {
  const changes = getChanges(latest, draft);
  return [
    ...(changes.title !== undefined
      ? [{ label: "主题", current: latest.title, proposed: changes.title }]
      : []),
    ...(changes.summary !== undefined
      ? [
          {
            label: "初次沟通内容",
            current: latest.summary,
            proposed: changes.summary,
          },
        ]
      : []),
    ...(changes.ownerUserId !== undefined
      ? [
          {
            label: "业务员",
            current: latest.owner?.name ?? "",
            proposed: draft.owner?.name ?? "",
          },
        ]
      : []),
    ...(changes.tagIds !== undefined
      ? [
          {
            label: "标签",
            current: latest.tags.map(({ name }) => name).join("、"),
            proposed: draft.tags.map(({ name }) => name).join("、"),
          },
        ]
      : []),
  ];
}
