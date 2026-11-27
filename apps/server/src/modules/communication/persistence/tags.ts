import type { DatabaseTransaction } from "@repo/db";
import {
  communicationTag,
  communicationTagAssignment,
  organization,
} from "@repo/db/schema";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

const tagFields = {
  id: communicationTag.id,
  name: communicationTag.name,
  color: communicationTag.color,
  createdAt: communicationTag.createdAt,
  departmentId: communicationTag.departmentId,
};

const catalogFields = { ...tagFields, departmentName: organization.name };

export async function selectTagPage(
  tx: DatabaseTransaction,
  {
    search,
    page,
    pageSize,
    departmentId,
  }: { search?: string; page: number; pageSize: number; departmentId?: string }
) {
  const filter = and(
    departmentId === undefined
      ? undefined
      : eq(communicationTag.departmentId, departmentId),
    search
      ? sql`position(lower(${search}) in ${communicationTag.normalizedName}) > 0`
      : undefined
  );
  const tags = await tx
    .select(catalogFields)
    .from(communicationTag)
    .leftJoin(organization, eq(organization.id, communicationTag.departmentId))
    .where(filter)
    .orderBy(asc(communicationTag.normalizedName), asc(communicationTag.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await tx
    .select({ count: count() })
    .from(communicationTag)
    .where(filter);
  return { tags, total: total.count, page, pageSize };
}

export async function findTag(tx: DatabaseTransaction, id: string) {
  const [tag] = await tx
    .select(catalogFields)
    .from(communicationTag)
    .leftJoin(organization, eq(organization.id, communicationTag.departmentId))
    .where(eq(communicationTag.id, id));
  return tag;
}

export async function insertTag(
  tx: DatabaseTransaction,
  input: {
    name: string;
    color?: string;
    departmentId: string;
    createdByUserId: string;
  }
) {
  const [tag] = await tx
    .insert(communicationTag)
    .values(input)
    .returning(tagFields);
  return tag;
}

export async function lockTag(
  tx: DatabaseTransaction,
  id: string,
  departmentId?: string
) {
  const [tag] = await tx
    .select(tagFields)
    .from(communicationTag)
    .where(
      and(
        eq(communicationTag.id, id),
        departmentId === undefined
          ? undefined
          : eq(communicationTag.departmentId, departmentId)
      )
    )
    .for("update");
  return tag;
}

export async function updateTag(
  tx: DatabaseTransaction,
  id: string,
  input: { name?: string; color: string }
) {
  const [tag] = await tx
    .update(communicationTag)
    .set(input)
    .where(eq(communicationTag.id, id))
    .returning(tagFields);
  return tag;
}

export async function countTagReferences(tx: DatabaseTransaction, id: string) {
  const [total] = await tx
    .select({ count: count() })
    .from(communicationTagAssignment)
    .where(eq(communicationTagAssignment.tagId, id));
  return total.count;
}

export function deleteTag(tx: DatabaseTransaction, id: string) {
  return tx.delete(communicationTag).where(eq(communicationTag.id, id));
}

export function selectAssignableCommunicationTagIds(
  tx: DatabaseTransaction,
  departmentId: string,
  ids: string[]
) {
  return tx
    .select({ id: communicationTag.id })
    .from(communicationTag)
    .where(
      and(
        eq(communicationTag.departmentId, departmentId),
        inArray(communicationTag.id, ids)
      )
    )
    .orderBy(asc(communicationTag.id))
    .for("key share");
}
