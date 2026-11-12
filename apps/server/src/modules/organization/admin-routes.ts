import { companyAdministrator } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import { auth, database } from "../identity/auth/better-auth";
import { appointSupervisor, createDepartment } from "./departments";
import { fail } from "./errors";

async function requireCompanyAdministrator(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) fail(401, "请先登录。");
  const [admin] = await database.db
    .select({ userId: companyAdministrator.userId })
    .from(companyAdministrator)
    .where(eq(companyAdministrator.userId, session.user.id))
    .limit(1);
  if (!admin) fail(403, "只有公司管理员可以管理部门。");
  return admin.userId;
}

async function readText(c: Context, key: string, maxLength: number) {
  const contentType = c.req
    .header("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") fail(415, "请提交 JSON 格式的数据。");
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const raw = body?.[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > maxLength || value.includes("\0")) {
    fail(400, "请检查填写的内容。");
  }
  return value;
}

export const departmentAdminRoutes = new Hono();

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
