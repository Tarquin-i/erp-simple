import { HTTPException } from "hono/http-exception";

/**
 * 中止当前请求，并交给 Hono 返回 JSON 错误响应。
 * @param status HTTP 错误状态码。
 * @param message 响应体 `message` 字段的内容。
 * @returns 无正常返回。
 * @throws 始终抛出携带 `{ message }` 响应的 `HTTPException`。
 */
export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 415,
  message: string
): never {
  throw new HTTPException(status, {
    res: Response.json({ message }, { status }),
  });
}
