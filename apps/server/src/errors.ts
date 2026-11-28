import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ModuleError } from "./modules/shared/application-error";

export class ApplicationError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly details: { code?: string; current?: unknown } = {}
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export type ModuleErrorResponse = {
  status: ContentfulStatusCode;
  code?: string;
};

export function createServerErrorHandler(
  responseMappings: ReadonlyMap<
    string,
    Readonly<Record<string, ModuleErrorResponse>>
  >
): ErrorHandler {
  return (error, context) => {
    if (error instanceof ModuleError) {
      const responses = responseMappings.get(error.module);
      if (responses && Object.hasOwn(responses, error.reason)) {
        const { status, code } = responses[error.reason];
        // 保留已迁移接口原有的 JSON 类型和字符集。
        const response = Response.json(
          { code, message: error.message, current: error.current },
          { status }
        );
        return context.newResponse(response.body, response);
      }
    }

    if (error instanceof ApplicationError) {
      const { code, current } = error.details;
      return context.json(
        { code, message: error.message, current },
        error.status
      );
    }

    if ("getResponse" in error) {
      const response = error.getResponse();
      return context.newResponse(response.body, response);
    }

    console.error(error);
    return context.text("Internal Server Error", 500);
  };
}

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
