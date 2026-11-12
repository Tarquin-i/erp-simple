import { Hono } from "hono";

import { listDepartments } from "./departments";
import { requireAccountId } from "./request";
import { getViewer } from "./viewer";

export const organizationReadRoutes = new Hono();

organizationReadRoutes.get("/departments", async (c) => {
  return c.json(await listDepartments());
});

organizationReadRoutes.get("/viewer", async (c) => {
  const accountId = await requireAccountId(c.req.raw.headers);
  c.header("Cache-Control", "no-store");
  return c.json(await getViewer(accountId));
});
