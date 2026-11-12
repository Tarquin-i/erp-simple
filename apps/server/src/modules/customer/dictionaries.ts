import { customerChannel, customerTag } from "@repo/db/schema";
import { asc, count, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { BusinessAccessEnv } from "../business/access";
import { database } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import {
  isConstraintError,
  readObject,
  readPositiveInteger,
  readString,
} from "./input";

const tagFields = {
  id: customerTag.id,
  name: customerTag.name,
  color: customerTag.color,
  createdAt: customerTag.createdAt,
};

export const customerDictionaryRoutes = new Hono<BusinessAccessEnv>();

customerDictionaryRoutes.get("/channels", async (c) => {
  const channels = await database.db
    .select({
      code: customerChannel.code,
      name: customerChannel.name,
      color: customerChannel.color,
    })
    .from(customerChannel)
    .orderBy(asc(customerChannel.code));

  return c.json({ channels });
});

customerDictionaryRoutes.get("/tags", async (c) => {
  const page = readPositiveInteger(c.req.query("page"), "页码", 1, 1_000_000);
  const pageSize = readPositiveInteger(
    c.req.query("pageSize"),
    "每页条数",
    20,
    100
  );
  const rawSearch = c.req.query("search")?.trim();
  const search = rawSearch
    ? readString(rawSearch, "标签搜索词", 64)
    : undefined;
  const filter = search
    ? sql`position(lower(${search}) in ${customerTag.normalizedName}) > 0`
    : undefined;

  const result = await database.db.transaction(
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

  return c.json(result);
});

customerDictionaryRoutes.post("/tags", async (c) => {
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
      .insert(customerTag)
      .values({ name, color })
      .returning(tagFields);

    return c.json({ tag }, 201);
  } catch (error) {
    if (
      isConstraintError(error, "23505", "customer_tag_normalized_name_unique")
    ) {
      return c.json(
        { code: "tag_name_exists", message: "标签名称已存在。" },
        409
      );
    }
    throw error;
  }
});
