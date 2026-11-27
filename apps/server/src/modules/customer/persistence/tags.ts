import type { Database, DatabaseTransaction } from "@repo/db";
import { customerTag, customerTagAssignment } from "@repo/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";

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

export async function findCustomerTag(
  db: Database | DatabaseTransaction,
  id: string
) {
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

export async function lockCustomerTag(tx: DatabaseTransaction, id: string) {
  const [tag] = await tx
    .select(tagFields)
    .from(customerTag)
    .where(eq(customerTag.id, id))
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
