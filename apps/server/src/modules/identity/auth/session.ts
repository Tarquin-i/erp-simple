import { ModuleError } from "../../shared/application-error";
import type { createPublicAuth } from "./better-auth";

export type RequireAccountId = (headers: Headers) => Promise<string>;

/** 从公开认证实例读取会话，只返回当前账号 ID。 */
export function createRequireAccountId(
  auth: ReturnType<typeof createPublicAuth>
): RequireAccountId {
  return async function requireAccountId(headers: Headers) {
    const session = await auth.api.getSession({ headers });
    if (!session)
      throw new ModuleError("identity", "sessionRequired", "请先登录。");
    return session.user.id;
  };
}
