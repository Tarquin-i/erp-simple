import type { DatabaseTransaction } from "@repo/db";
import { communicationTag, customerTag } from "@repo/db/schema";
import { and, inArray } from "drizzle-orm";

import type { DepartmentKey } from "./account-definitions";

type SeedTag = { name: string; color: string };
type StoredTag = {
  id: string;
  departmentId: string | null;
  normalizedName: string;
};

export type DepartmentSeedTagIds = {
  customers: readonly string[];
  communications: readonly string[];
};

const departmentTags: Record<
  DepartmentKey,
  { customers: SeedTag[]; communications: SeedTag[] }
> = {
  a: {
    customers: [
      { name: "展会线索", color: "#2563eb" },
      { name: "样品确认", color: "#ea580c" },
    ],
    communications: [
      { name: "报价回访", color: "#2563eb" },
      { name: "样品反馈", color: "#9333ea" },
    ],
  },
  b: {
    customers: [
      { name: "渠道合作", color: "#15803d" },
      { name: "复购意向", color: "#9333ea" },
    ],
    communications: [
      { name: "订单确认", color: "#15803d" },
      { name: "交期协调", color: "#ea580c" },
    ],
  },
  engineering: {
    customers: [
      { name: "技术对接", color: "#2563eb" },
      { name: "接口联调", color: "#9333ea" },
    ],
    communications: [
      { name: "问题排查", color: "#dc2626" },
      { name: "技术答复", color: "#2563eb" },
    ],
  },
  product: {
    customers: [
      { name: "试用客户", color: "#15803d" },
      { name: "需求共创", color: "#9333ea" },
    ],
    communications: [
      { name: "产品反馈", color: "#ea580c" },
      { name: "方案评审", color: "#9333ea" },
    ],
  },
};

function resolveTagIds(
  tags: SeedTag[],
  departmentId: string,
  storedTags: StoredTag[]
) {
  return tags.map(({ name }) => {
    const tag = storedTags.find(
      (row) =>
        row.departmentId === departmentId &&
        row.normalizedName === name.trim().toLowerCase()
    );
    if (!tag)
      throw new Error(`找不到部门 ${departmentId} 的种子标签「${name}」。`);
    return tag.id;
  });
}

export async function seedDepartmentTags(
  tx: DatabaseTransaction,
  departmentIds: ReadonlyMap<DepartmentKey, string>
) {
  const customerTags = [...departmentIds].flatMap(([key, departmentId]) =>
    departmentTags[key].customers.map((tag) => ({ ...tag, departmentId }))
  );
  const communicationTags = [...departmentIds].flatMap(([key, departmentId]) =>
    departmentTags[key].communications.map((tag) => ({ ...tag, departmentId }))
  );

  const createdCustomerTags = await tx
    .insert(customerTag)
    .values(customerTags)
    .onConflictDoNothing({
      target: [customerTag.departmentId, customerTag.normalizedName],
    })
    .returning({ id: customerTag.id });
  const createdCommunicationTags = await tx
    .insert(communicationTag)
    .values(communicationTags)
    .onConflictDoNothing({
      target: [communicationTag.departmentId, communicationTag.normalizedName],
    })
    .returning({ id: communicationTag.id });

  const ids = [...departmentIds.values()];
  const storedCustomerTags = await tx
    .select({
      id: customerTag.id,
      departmentId: customerTag.departmentId,
      normalizedName: customerTag.normalizedName,
    })
    .from(customerTag)
    .where(
      and(
        inArray(customerTag.departmentId, ids),
        inArray(
          customerTag.normalizedName,
          customerTags.map(({ name }) => name.trim().toLowerCase())
        )
      )
    );
  const storedCommunicationTags = await tx
    .select({
      id: communicationTag.id,
      departmentId: communicationTag.departmentId,
      normalizedName: communicationTag.normalizedName,
    })
    .from(communicationTag)
    .where(
      and(
        inArray(communicationTag.departmentId, ids),
        inArray(
          communicationTag.normalizedName,
          communicationTags.map(({ name }) => name.trim().toLowerCase())
        )
      )
    );
  const tagIdsByDepartment = new Map<DepartmentKey, DepartmentSeedTagIds>();
  for (const [key, departmentId] of departmentIds) {
    const tags = departmentTags[key];
    tagIdsByDepartment.set(key, {
      customers: resolveTagIds(
        tags.customers,
        departmentId,
        storedCustomerTags
      ),
      communications: resolveTagIds(
        tags.communications,
        departmentId,
        storedCommunicationTags
      ),
    });
  }

  return {
    createdCustomerTags: createdCustomerTags.length,
    createdCommunicationTags: createdCommunicationTags.length,
    tagIdsByDepartment,
  };
}
