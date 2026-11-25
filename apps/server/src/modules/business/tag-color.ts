import type { communicationTag, customerTag } from "@repo/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Context } from "hono";

import { readObject, readString, readUuid } from "../customer/input";
import { database } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { readBusinessAccess } from "./access";
import type { BusinessAccessEnv } from "./access";

type TagTable = typeof customerTag | typeof communicationTag;

const forbidden = "仅公司管理员可以修改共享标签颜色。";

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

export async function updateTagColor(
  c: Context<BusinessAccessEnv>,
  table: TagTable
) {
  const access = c.get("businessAccess");
  if (access.scope !== "company") fail(403, forbidden);

  const id = readUuid(c.req.param("tagId"), "标签 ID");
  const body = await readObject(c, ["color", "expectedColor"]);
  const color = readTagColor(body.color);
  const expectedColor = readTagColor(body.expectedColor, "原标签颜色");

  const currentAccess = await readBusinessAccess(database.db, access.userId);
  if (currentAccess.scope !== "company") fail(403, forbidden);

  const tagById = eq(table.id, id);
  const storedColor = sql<string>`lower(${table.color})`;
  const fields = tagDictionaryFields(table);
  const [tag] = await database.db
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
  if (tag) return c.json({ tag });

  const [current] = await database.db.select(fields).from(table).where(tagById);
  if (!current) fail(404, "标签不存在。");
  // 上次保存成功但响应丢失时，相同目标颜色可以直接重试。
  if (current.color.toLowerCase() === color.toLowerCase()) {
    return c.json({ tag: current });
  }
  return c.json(
    {
      code: "tag_color_conflict",
      message: "标签颜色已被更新，请查看当前颜色后再保存。",
      current,
    },
    409
  );
}
