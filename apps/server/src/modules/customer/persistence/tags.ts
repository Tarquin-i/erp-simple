import type { Database } from "@repo/db";
import { customerTag } from "@repo/db/schema";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";

const tagFields = {
  id: customerTag.id,
  name: customerTag.name,
  color: customerTag.color,
  createdAt: customerTag.createdAt,
};

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

export async function updateCustomerTagColor(
  db: Database,
  id: string,
  color: string,
  expectedColor: string
) {
  const tagById = eq(customerTag.id, id);
  const storedColor = sql<string>`lower(${customerTag.color})`;
  const [tag] = await db
    .update(customerTag)
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

  const [current] = await db.select(tagFields).from(customerTag).where(tagById);
  if (!current) return { kind: "not-found" } as const;
  // 上次保存成功但响应丢失时，相同目标颜色可以直接重试。
  if (current.color.toLowerCase() === color.toLowerCase()) {
    return { kind: "saved", tag: current } as const;
  }
  return { kind: "conflict", current } as const;
}
