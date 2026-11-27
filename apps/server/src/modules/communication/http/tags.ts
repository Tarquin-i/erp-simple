import { Hono } from "hono";

import { fail } from "../../../errors";
import {
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import type { RecordAccessEnv } from "../../identity/http/record-access-context";
import type { CommunicationModule } from "../module";

function readTagColor(value: unknown, label = "标签颜色") {
  const color = readString(value, label, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    fail(400, `${label}须为 #RRGGBB 格式。`);
  }
  return color;
}

export function createCommunicationTagRoutes(
  tags: CommunicationModule["tags"]
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/tags", async (c) => {
    const {
      search: rawSearch,
      page: rawPage,
      pageSize: rawPageSize,
      departmentId: requestedDepartment,
    } = c.req.query();
    const page = readPositiveInteger(rawPage, "页码", 1, 1_000_000);
    const pageSize = readPositiveInteger(rawPageSize, "每页条数", 20, 100);
    const search = rawSearch?.trim()
      ? readString(rawSearch, "标签搜索词", 64)
      : undefined;
    const departmentId =
      requestedDepartment === undefined
        ? undefined
        : readString(requestedDepartment, "部门 ID", 128);
    return c.json(
      await tags.list(c.get("recordAccess"), {
        search,
        page,
        pageSize,
        departmentId,
      })
    );
  });

  routes.get("/tags/:tagId", async (c) => {
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    return c.json({ tag: await tags.get(c.get("recordAccess"), id) });
  });

  routes.get("/tags/:tagId/usage", async (c) => {
    const access = c.get("recordAccess");
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    return c.json(await tags.usage(access, id));
  });

  routes.patch("/tags/:tagId", async (c) => {
    const access = c.get("recordAccess");
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    const body = await readObject(c, [
      "color",
      "expectedColor",
      "name",
      "expectedName",
    ]);
    const color = readTagColor(body.color);
    const expectedColor = readTagColor(body.expectedColor, "原标签颜色");
    const nameFields =
      body.name === undefined && body.expectedName === undefined
        ? {}
        : {
            name: readString(body.name, "标签名称", 64),
            expectedName: readString(body.expectedName, "原标签名称", 64),
          };
    return c.json({
      tag: await tags.update(access, id, {
        color,
        expectedColor,
        ...nameFields,
      }),
    });
  });

  routes.delete("/tags/:tagId", async (c) => {
    const access = c.get("recordAccess");
    const id = readUuid(c.req.param("tagId"), "标签 ID");
    const body = await readObject(c, ["expectedName", "expectedColor"]);
    const expectedName = readString(body.expectedName, "原标签名称", 64);
    const expectedColor = readTagColor(body.expectedColor, "原标签颜色");
    await tags.remove(access, id, { expectedName, expectedColor });
    return c.json({ deleted: true });
  });

  routes.post("/tags", async (c) => {
    const body = await readObject(c, ["name", "color", "departmentId"]);
    const name = readString(body.name, "标签名称", 64);
    const color =
      body.color === undefined ? undefined : readTagColor(body.color);
    const departmentId =
      body.departmentId === undefined
        ? undefined
        : readString(body.departmentId, "部门 ID", 128);
    return c.json(
      {
        tag: await tags.create(c.get("recordAccess"), {
          name,
          color,
          departmentId,
        }),
      },
      201
    );
  });

  return routes;
}
