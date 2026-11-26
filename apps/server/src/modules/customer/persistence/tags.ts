import type { Database } from "@repo/db";
import { customerTag } from "@repo/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";

import {
  tagDictionaryFields,
  updateStoredTagColor,
} from "../../business/tag-color";

const tagFields = tagDictionaryFields(customerTag);

export function listCustomerTags(
  db: Database,
  {
    page,
    pageSize,
    search,
  }: { page: number; pageSize: number; search?: string }
) {
  const filter = search
    ? sql`position(lower(${search}) in ${customerTag.normalizedName}) > 0`
    : undefined;

  // 分页数据和总数使用同一个只读快照，避免并发写入造成两者不一致。
  return db.transaction(
    async (tx) => {
      const tags = await tx
        .select(tagFields)
        .from(customerTag)
        .where(filter)
        .orderBy(asc(customerTag.normalizedName), asc(customerTag.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [total] = await tx
        .select({ count: count() })
        .from(customerTag)
        .where(filter);

      return { tags, total: total.count, page, pageSize };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

export async function findCustomerTag(db: Database, id: string) {
  const [tag] = await db
    .select(tagFields)
    .from(customerTag)
    .where(eq(customerTag.id, id));
  return tag;
}

export async function insertCustomerTag(
  db: Database,
  name: string,
  color: string | undefined
) {
  const [tag] = await db
    .insert(customerTag)
    .values({ name, color })
    .returning(tagFields);
  return tag;
}

export function updateCustomerTagColor(
  db: Database,
  id: string,
  color: string,
  expectedColor: string
) {
  return updateStoredTagColor(db, customerTag, id, color, expectedColor);
}
