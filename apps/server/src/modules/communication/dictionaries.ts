import { communicationTag } from "@repo/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { withBusinessReadSnapshot } from "../business/access";
import type { BusinessAccessEnv } from "../business/access";
import {
  isConstraintError,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../customer/input";
import { database } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";

const tagFields = {
  id: communicationTag.id,
  name: communicationTag.name,
  color: communicationTag.color,
  createdAt: communicationTag.createdAt,
};

export const communicationDictionaryRoutes = new Hono<BusinessAccessEnv>();

communicationDictionaryRoutes.get("/tags", async (c) => {
  const {
    search: rawSearch,
    page: rawPage,
    pageSize: rawPageSize,
  } = c.req.query();
  const page = readPositiveInteger(rawPage, "页码", 1, 1_000_000);
  const pageSize = readPositiveInteger(rawPageSize, "每页条数", 20, 100);
  const search = rawSearch?.trim()
    ? readString(rawSearch, "标签搜索词", 64)
    : undefined;
  const filter = search
    ? sql`position(lower(${search}) in ${communicationTag.normalizedName}) > 0`
    : undefined;

  // 分页和总数从同一快照读取，权限以读取时的账号状态为准。
  const result = await withBusinessReadSnapshot(
    c.get("businessAccess").userId,
    async (tx) => {
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
  );

  return c.json(result);
});

communicationDictionaryRoutes.get("/tags/:tagId", async (c) => {
  const id = readUuid(c.req.param("tagId"), "标签 ID");
  const [tag] = await withBusinessReadSnapshot(
    c.get("businessAccess").userId,
    (tx) =>
      tx
        .select(tagFields)
        .from(communicationTag)
        .where(eq(communicationTag.id, id))
  );
  if (!tag) fail(404, "标签不存在。");
  return c.json({ tag });
});

communicationDictionaryRoutes.post("/tags", async (c) => {
  const body = await readObject(c, ["name", "color"]);
  const name = readString(body.name, "标签名称", 64);
  const color =
    body.color === undefined
      ? undefined
      : readString(body.color, "标签颜色", 7);
  if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) {
    fail(400, "标签颜色须为 #RRGGBB 格式。");
  }

  try {
    const [tag] = await database.db
      .insert(communicationTag)
      .values({ name, color })
      .returning(tagFields);
    return c.json({ tag }, 201);
  } catch (error) {
    if (
      isConstraintError(
        error,
        "23505",
        "communication_tag_normalized_name_unique"
      )
    ) {
      return c.json(
        { code: "tag_name_exists", message: "标签名称已存在。" },
        409
      );
    }
    throw error;
  }
});
