import { Hono } from "hono";

import { fail } from "../../../errors";
import type { RecordAccessEnv } from "../../identity/http/record-access-context";
import { createCustomerError } from "../application/errors";
import type { createTagUseCases } from "../application/tags";
import {
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";

function readTagColor(value: unknown, label = "标签颜色") {
  const color = readString(value, label, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    fail(400, `${label}须为 #RRGGBB 格式。`);
  }
  return color;
}

export function createCustomerTagRoutes(
  tags: ReturnType<typeof createTagUseCases>
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/tags", async (c) => {
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

    return c.json(await tags.list({ page, pageSize, search }));
  });

  routes.get("/tags/:tagId", async (c) => {
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    return c.json({ tag: await tags.get(id) });
  });

  routes.patch("/tags/:tagId", async (c) => {
    const access = c.get("recordAccess");
    if (access.scope !== "company") {
      throw createCustomerError("tagColorForbidden");
    }

    const id = readUuid(c.req.param("tagId"), "标签 ID");
    const body = await readObject(c, ["color", "expectedColor"]);
    const color = readTagColor(body.color);
    const expectedColor = readTagColor(body.expectedColor, "原标签颜色");
    const tag = await tags.updateColor({
      userId: access.userId,
      id,
      color,
      expectedColor,
    });
    return c.json({ tag });
  });

  routes.post("/tags", async (c) => {
    const body = await readObject(c, ["name", "color"]);
    const name = readString(body.name, "标签名称", 64);
    const color =
      body.color === undefined ? undefined : readTagColor(body.color);
    return c.json({ tag: await tags.create(name, color) }, 201);
  });

  return routes;
}
