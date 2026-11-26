import type { communicationTag, customerTag } from "@repo/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";

import { readString } from "../../http/request-input";
import type { Database } from "../identity/auth/better-auth";
import { fail } from "../../errors";

type TagTable = typeof customerTag | typeof communicationTag;

export function readTagColor(value: unknown, label = "标签颜色") {
  const color = readString(value, label, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    fail(400, `${label}须为 #RRGGBB 格式。`);
  }
  return color;
}

export function tagDictionaryFields(table: TagTable) {
  return {
    id: table.id,
    name: table.name,
    color: table.color,
    createdAt: table.createdAt,
  };
}

export async function updateStoredTagColor(
  db: Database,
  table: TagTable,
  id: string,
  color: string,
  expectedColor: string
) {
  const tagById = eq(table.id, id);
  const storedColor = sql<string>`lower(${table.color})`;
  const fields = tagDictionaryFields(table);
  const [tag] = await db
    .update(table)
    .set({ color })
    .where(
      and(
        tagById,
        eq(storedColor, expectedColor.toLowerCase()),
        ne(storedColor, color.toLowerCase())
      )
    )
    .returning(fields);
  if (tag) return { kind: "saved", tag } as const;

  const [current] = await db.select(fields).from(table).where(tagById);
  if (!current) return { kind: "not-found" } as const;
  // 上次保存成功但响应丢失时，相同目标颜色可以直接重试。
  if (current.color.toLowerCase() === color.toLowerCase()) {
    return { kind: "saved", tag: current } as const;
  }
  return { kind: "conflict", current } as const;
}
