import type { Context } from "hono";

import { auth } from "../identity/auth/better-auth";
import { fail } from "./errors";

/**
 * 从请求头读取 Better Auth 会话，确认请求已登录。
 * @param headers 当前 HTTP 请求的请求头。
 * @returns 会话中的用户 ID。
 * @throws 没有有效会话时抛出 HTTP 401。
 */
export async function requireAccountId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) fail(401, "请先登录。");
  return session.user.id;
}

/**
 * 从 JSON 请求体读取必填文本字段并去掉首尾空白。
 * @param c 当前请求的 Hono 上下文。
 * @param key 请求体中的字段名。
 * @param maxLength 去掉首尾空白后的最大长度。
 * @returns 校验通过的文本。
 * @throws 请求类型不为 JSON 时抛出 HTTP 415，字段缺失或格式无效时抛出 HTTP 400。
 */
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
