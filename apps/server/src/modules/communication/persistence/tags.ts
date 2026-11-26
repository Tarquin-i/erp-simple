import type { Database, DatabaseTransaction } from "@repo/db";
import { communicationTag } from "@repo/db/schema";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";

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

export async function updateTagColor(
  db: Database,
  id: string,
  color: string,
  expectedColor: string
) {
  const tagById = eq(communicationTag.id, id);
  const storedColor = sql<string>`lower(${communicationTag.color})`;
  const [tag] = await db
    .update(communicationTag)
    .set({ color })
    .where(
      and(
        tagById,
        eq(storedColor, expectedColor.toLowerCase()),
        ne(storedColor, color.toLowerCase())
      )
    )
    .returning(tagFields);
  if (tag) return { kind: "saved", tag } as const;

  const [current] = await db
    .select(tagFields)
    .from(communicationTag)
    .where(tagById);
  if (!current) return { kind: "not-found" } as const;
  // 上次保存成功但响应丢失时，相同目标颜色可以直接重试。
  if (current.color.toLowerCase() === color.toLowerCase()) {
    return { kind: "saved", tag: current } as const;
  }
  return { kind: "conflict", current } as const;
}
