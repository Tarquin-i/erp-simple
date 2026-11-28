import { Hono } from "hono";

import type { RequireAccountId } from "../../identity";
import type { OrganizationModule } from "../module";
import { createDepartmentApplicationRoutes } from "./department-applications";
import { createDepartmentRoutes } from "./departments";

export function createOrganizationRoutes(
  module: OrganizationModule,
  requireAccountId: RequireAccountId
) {
  const routes = new Hono();
  routes.route("/", createDepartmentRoutes(module, requireAccountId));
  routes.route(
    "/",
    createDepartmentApplicationRoutes(
      module.departmentApplications,
      requireAccountId
    )
  );

  routes.get("/viewer", async (c) => {
    const accountId = await requireAccountId(c.req.raw.headers);
    c.header("Cache-Control", "no-store");
    return c.json(await module.viewer.getViewer(accountId));
  });

  return routes;
}
