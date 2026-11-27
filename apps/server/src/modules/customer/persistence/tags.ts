import type { DatabaseTransaction } from "@repo/db";
import {
  customerTag,
  customerTagAssignment,
  organization,
} from "@repo/db/schema";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

const tagFields = {
  id: customerTag.id,
  name: customerTag.name,
  color: customerTag.color,
  createdAt: customerTag.createdAt,
  departmentId: customerTag.departmentId,
};

const catalogFields = { ...tagFields, departmentName: organization.name };

export async function listCustomerTags(
  tx: DatabaseTransaction,
  {
    page,
    pageSize,
    search,
    departmentId,
  }: { page: number; pageSize: number; search?: string; departmentId?: string }
) {
  const filter = and(
    departmentId === undefined
      ? undefined
      : eq(customerTag.departmentId, departmentId),
    search
      ? sql`position(lower(${search}) in ${customerTag.normalizedName}) > 0`
      : undefined
  );

  const tags = await tx
    .select(catalogFields)
    .from(customerTag)
    .leftJoin(organization, eq(organization.id, customerTag.departmentId))
    .where(filter)
    .orderBy(asc(customerTag.normalizedName), asc(customerTag.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await tx
    .select({ count: count() })
    .from(customerTag)
    .where(filter);

  return { tags, total: total.count, page, pageSize };
}

export async function findCustomerTag(tx: DatabaseTransaction, id: string) {
  const [tag] = await tx
    .select(catalogFields)
    .from(customerTag)
    .leftJoin(organization, eq(organization.id, customerTag.departmentId))
    .where(eq(customerTag.id, id));
  return tag;
}

export async function insertCustomerTag(
  tx: DatabaseTransaction,
  input: {
    name: string;
    color?: string;
    departmentId: string;
    createdByUserId: string;
  }
) {
  const [tag] = await tx.insert(customerTag).values(input).returning(tagFields);
  return tag;
}

export async function lockCustomerTag(
  tx: DatabaseTransaction,
  id: string,
  departmentId?: string
) {
  const [tag] = await tx
    .select(tagFields)
    .from(customerTag)
    .where(
      and(
        eq(customerTag.id, id),
        departmentId === undefined
          ? undefined
          : eq(customerTag.departmentId, departmentId)
      )
    )
    .for("update");
  return tag;
}

export async function updateCustomerTag(
  tx: DatabaseTransaction,
  id: string,
  input: { name?: string; color: string }
) {
  const [tag] = await tx
    .update(customerTag)
    .set(input)
    .where(eq(customerTag.id, id))
    .returning(tagFields);
  return tag;
}

export async function countCustomerTagReferences(
  tx: DatabaseTransaction,
  id: string
) {
  const [total] = await tx
    .select({ count: count() })
    .from(customerTagAssignment)
    .where(eq(customerTagAssignment.tagId, id));
  return total.count;
}

export function deleteCustomerTag(tx: DatabaseTransaction, id: string) {
  return tx.delete(customerTag).where(eq(customerTag.id, id));
}

export function selectAssignableCustomerTagIds(
  tx: DatabaseTransaction,
  departmentId: string,
  ids: string[]
) {
  return tx
    .select({ id: customerTag.id })
    .from(customerTag)
    .where(
      and(
        eq(customerTag.departmentId, departmentId),
        inArray(customerTag.id, ids)
      )
    )
    .orderBy(asc(customerTag.id))
    .for("key share");
}
