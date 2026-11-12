import type { Context } from "hono";

import { auth } from "../identity/auth/better-auth";
import { fail } from "./errors";

export async function requireAccountId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) fail(401, "请先登录。");
  return session.user.id;
}

export async function readText(c: Context, key: string, maxLength: number) {
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
