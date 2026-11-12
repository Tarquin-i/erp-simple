import { Hono } from "hono";

import {
  listPendingApplications,
  reviewApplication,
  submitApplication,
} from "./applications";
import { fail } from "./errors";
import { readText, requireAccountId } from "./request";

const applicationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const departmentApplicationRoutes = new Hono();

departmentApplicationRoutes.post("/applications", async (c) => {
  const accountId = await requireAccountId(c.req.raw.headers);
  const departmentId = await readText(c, "departmentId", 128);
  const { application, created } = await submitApplication(
    accountId,
    departmentId
  );
  return c.json(application, created ? 201 : 200);
});

departmentApplicationRoutes.get("/applications", async (c) => {
  const accountId = await requireAccountId(c.req.raw.headers);
  c.header("Cache-Control", "no-store");
  return c.json(await listPendingApplications(accountId));
});

departmentApplicationRoutes.post(
  "/applications/:applicationId/review",
  async (c) => {
    const accountId = await requireAccountId(c.req.raw.headers);
    const applicationId = c.req.param("applicationId");
    if (!applicationIdPattern.test(applicationId)) fail(400, "申请编号无效。");
    const decision = await readText(c, "decision", 10);
    if (decision !== "approve" && decision !== "reject")
      fail(400, "请选择有效的审批结果。");
    return c.json(await reviewApplication(accountId, applicationId, decision));
  }
);
