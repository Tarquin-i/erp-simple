import { Hono } from "hono";

import type { RecordAccessEnv } from "../../identity";
import { createCustomerError } from "../application/errors";
import type { CustomerModule } from "../module";
import { readString, readUuid } from "../../../http/request-input";

export function createCustomerOwnerOptionRoutes(
  options: CustomerModule["ownerOptions"]
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/owners", async (c) => {
    const owners = await options.listVisibleOwners(c.get("recordAccess"));
    return c.json({ owners });
  });

  routes.get("/assignable-owners", async (c) => {
    const access = c.get("recordAccess");
    const requestedDepartment = c.req.query("departmentId");
    if (requestedDepartment !== undefined && access.scope !== "company") {
      throw createCustomerError("ownerDepartmentForbidden");
    }
    const owners = await options.listAssignableOwners(access, {
      departmentId:
        requestedDepartment === undefined
          ? undefined
          : readString(requestedDepartment, "部门 ID", 128),
    });
    return c.json({ owners });
  });

  routes.get("/:customerId/assignable-owners", async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const owners = await options.listAssignableOwners(c.get("recordAccess"), {
      customerId,
    });
    return c.json({ owners });
  });

  return routes;
}
