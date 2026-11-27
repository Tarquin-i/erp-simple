import type { Database, DatabaseTransaction } from "@repo/db";
import { communicationTag, communicationTagAssignment } from "@repo/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";

const tagFields = {
  id: communicationTag.id,
  name: communicationTag.name,
  color: communicationTag.color,
  createdAt: communicationTag.createdAt,
};

export async function selectTagPage(
  tx: DatabaseTransaction,
  {
    search,
    page,
    pageSize,
  }: { search?: string; page: number; pageSize: number }
) {
  const filter = search
    ? sql`position(lower(${search}) in ${communicationTag.normalizedName}) > 0`
    : undefined;
  const tags = await tx
    .select(tagFields)
    .from(communicationTag)
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
    .select(tagFields)
    .from(communicationTag)
    .where(eq(communicationTag.id, id));
  return tag;
}

export async function insertTag(
  db: Database,
  name: string,
  color: string | undefined
) {
  const [tag] = await db
    .insert(communicationTag)
    .values({ name, color })
    .returning(tagFields);
  return tag;
}

export async function lockTag(tx: DatabaseTransaction, id: string) {
  const [tag] = await tx
    .select(tagFields)
    .from(communicationTag)
    .where(eq(communicationTag.id, id))
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
