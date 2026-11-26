import { auth } from "./better-auth";
import { fail } from "../../../errors";

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
