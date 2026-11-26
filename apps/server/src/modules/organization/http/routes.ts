import { Hono } from "hono";

import type { OrganizationModule } from "../module";
import { requireAccountId } from "../../identity/auth/session";
import { createDepartmentApplicationRoutes } from "./department-applications";
import { createDepartmentRoutes } from "./departments";

export function createOrganizationRoutes(module: OrganizationModule) {
  const routes = new Hono();
  routes.route("/", createDepartmentRoutes(module));
  routes.route(
    "/",
    createDepartmentApplicationRoutes(module.departmentApplications)
  );

  routes.get("/viewer", async (c) => {
    const accountId = await requireAccountId(c.req.raw.headers);
    c.header("Cache-Control", "no-store");
    return c.json(await module.viewer.getViewer(accountId));
  });

  return routes;
}
