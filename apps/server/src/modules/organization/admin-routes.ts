import { companyAdministrator } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { database } from "../identity/auth/better-auth";
import {
  appointSupervisor,
  createDepartment,
  listDepartmentRoster,
} from "./departments";
import { fail } from "./errors";
import { readText, requireAccountId } from "./request";

/**
 * 校验当前登录账号能否调用公司级部门管理接口。
 * @param headers 包含会话凭据的请求头。
 * @returns 公司管理员的账号 ID。
 * @throws 无有效会话时抛出 HTTP 401，账号不是公司管理员时抛出 HTTP 403。
 */
async function requireCompanyAdministrator(headers: Headers) {
  const accountId = await requireAccountId(headers);
  const [admin] = await database.db
    .select({ userId: companyAdministrator.userId })
    .from(companyAdministrator)
    .where(eq(companyAdministrator.userId, accountId))
    .limit(1);
  if (!admin) fail(403, "只有公司管理员可以管理部门。");
  return admin.userId;
}

export const departmentAdminRoutes = new Hono();

departmentAdminRoutes.get("/departments", async (c) => {
  await requireCompanyAdministrator(c.req.raw.headers);
  c.header("Cache-Control", "no-store");
  return c.json(await listDepartmentRoster());
});

departmentAdminRoutes.post("/departments", async (c) => {
  await requireCompanyAdministrator(c.req.raw.headers);
  const name = await readText(c, "name", 80);
  return c.json(await createDepartment(name), 201);
});

departmentAdminRoutes.post(
  "/departments/:departmentId/supervisor",
  async (c) => {
    const adminId = await requireCompanyAdministrator(c.req.raw.headers);
    const departmentId = c.req.param("departmentId");
    if (departmentId.length > 128 || departmentId.includes("\0")) {
      fail(400, "部门编号无效。");
    }
    const email = (await readText(c, "email", 254)).toLowerCase();
    return c.json(await appointSupervisor(departmentId, email, adminId));
  }
);
