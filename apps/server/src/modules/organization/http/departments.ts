import { Hono } from "hono";

import { requireAccountId } from "../../../auth";
import { fail } from "../../../errors";
import type { OrganizationModule } from "../module";
import { readText } from "./write-requests";

export function createDepartmentRoutes({
  departments,
  members,
}: Pick<OrganizationModule, "departments" | "members">) {
  const routes = new Hono();

  async function requireCompanyAdministrator(headers: Headers) {
    return departments.requireCompanyAdministrator(
      await requireAccountId(headers)
    );
  }

  routes.get("/departments", async (c) =>
    c.json(await departments.listDepartments())
  );

  routes.get("/admin/departments", async (c) => {
    await requireCompanyAdministrator(c.req.raw.headers);
    c.header("Cache-Control", "no-store");
    return c.json(await departments.listDepartmentRoster());
  });

  routes.post("/admin/departments", async (c) => {
    await requireCompanyAdministrator(c.req.raw.headers);
    const name = await readText(c, "name", 80);
    return c.json(await departments.createDepartment(name), 201);
  });

  routes.post("/admin/departments/:departmentId/supervisor", async (c) => {
    const adminId = await requireCompanyAdministrator(c.req.raw.headers);
    const departmentId = c.req.param("departmentId");
    if (departmentId.length > 128 || departmentId.includes("\0")) {
      fail(400, "部门编号无效。");
    }
    const email = (await readText(c, "email", 254)).toLowerCase();
    return c.json(
      await members.appointSupervisor(departmentId, email, adminId)
    );
  });

  return routes;
}
