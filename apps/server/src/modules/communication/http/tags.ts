import { Hono } from "hono";

import {
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import type { BusinessAccessEnv } from "../../business/access";
import { readTagColor } from "../../business/tag-color";
import { requireTagColorAccess } from "../application/tags";
import type { CommunicationModule } from "../module";

export function createCommunicationTagRoutes(
  tags: CommunicationModule["tags"]
) {
  const routes = new Hono<BusinessAccessEnv>();

  routes.get("/tags", async (c) => {
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
    return c.json(
      await tags.list(c.get("businessAccess"), { search, page, pageSize })
    );
  });

  routes.get("/tags/:tagId", async (c) => {
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    return c.json({ tag: await tags.get(c.get("businessAccess"), id) });
  });

  routes.patch("/tags/:tagId", async (c) => {
    const access = c.get("businessAccess");
    requireTagColorAccess(access);
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    const body = await readObject(c, ["color", "expectedColor"]);
    const color = readTagColor(body.color);
    const expectedColor = readTagColor(body.expectedColor, "原标签颜色");
    return c.json({
      tag: await tags.updateColor(access, id, color, expectedColor),
    });
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
