import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

import type { AccountRecordAccess } from "../../organization";

export type RecordAccessEnv = {
  Variables: { recordAccess: AccountRecordAccess };
};
export type RecordAccessMiddleware = MiddlewareHandler<RecordAccessEnv>;

/** 将已登录账号的记录访问范围写入请求上下文。 */
export function createRecordAccessContext({
  requireAccountId,
  readAccess,
}: {
  requireAccountId: (headers: Headers) => Promise<string>;
  readAccess: (userId: string) => Promise<AccountRecordAccess>;
}): RecordAccessMiddleware {
  return createMiddleware<RecordAccessEnv>(async (c, next) => {
    const userId = await requireAccountId(c.req.raw.headers);
    c.set("recordAccess", await readAccess(userId));
    await next();
  });
}
