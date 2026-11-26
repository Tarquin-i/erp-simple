import { communicationTag } from "@repo/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";

import {
  tagDictionaryFields,
  updateStoredTagColor,
} from "../../business/tag-color";
import type {
  Database,
  DatabaseTransaction,
} from "../../identity/auth/better-auth";

const tagFields = tagDictionaryFields(communicationTag);

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

export function updateTagColor(
  db: Database,
  id: string,
  color: string,
  expectedColor: string
) {
  return updateStoredTagColor(db, communicationTag, id, color, expectedColor);
}
