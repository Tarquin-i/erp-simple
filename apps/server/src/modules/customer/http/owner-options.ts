import { Hono } from "hono";

import type { BusinessAccessEnv } from "../../business/access";
import { createCustomerError } from "../application/errors";
import type { createOwnerOptionUseCases } from "../application/owner-options";
import { readString, readUuid } from "../../../http/request-input";

export function createCustomerOwnerOptionRoutes(
  options: ReturnType<typeof createOwnerOptionUseCases>
) {
  const routes = new Hono<BusinessAccessEnv>();

  routes.get("/owners", async (c) => {
    const owners = await options.listVisibleOwners(c.get("businessAccess"));
    return c.json({ owners });
  });

  routes.get("/assignable-owners", async (c) => {
    const access = c.get("businessAccess");
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
    const owners = await options.listAssignableOwners(c.get("businessAccess"), {
      customerId,
    });
    return c.json({ owners });
  });

  return routes;
}
