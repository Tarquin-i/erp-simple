import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export const handleServerError: ErrorHandler = (error, context) => {
  if ("getResponse" in error) {
    const response = error.getResponse();
    return context.newResponse(response.body, response);
  }

  console.error(error);
  return context.text("Internal Server Error", 500);
};

/**
 * 在版本不匹配时中止写入，提供最新资料供客户端比较。
 * @param current 从数据库读取的当前记录快照。
 * @throws 始终抛出 HTTP 409，响应包含 `version_conflict` 和 `current`。
 */
export function failVersionConflict(current: unknown): never {
  throw new HTTPException(409, {
    res: Response.json(
      {
        code: "version_conflict",
        message: "资料已被更新，请查看最新资料后确认是否覆盖。",
        current,
      },
      { status: 409 }
    ),
  });
}
