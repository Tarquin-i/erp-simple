import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { fail } from "../organization/errors";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * 读取 JSON 请求体并拒绝白名单以外的字段。
 * @param c 当前请求的 Hono 上下文。
 * @param allowed 允许提交的字段名。
 * @returns 通过结构和字段名校验的对象，字段值由调用方继续校验。
 * @throws 请求类型不为 JSON 时抛出 HTTP 415，请求体无效或包含未知字段时抛出 HTTP 400。
 */
export async function readObject(c: Context, allowed: readonly string[]) {
  const contentType = c.req
    .header("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") fail(415, "请提交 JSON 格式的数据。");
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "请提交 JSON 对象。");
  }
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    fail(400, "请求包含不支持的字段。");
  }
  return body as Record<string, unknown>;
}

/**
 * 读取必填文本并去掉首尾空白。
 * @param value 待校验的原始字段值。
 * @param label 错误提示中使用的字段名。
 * @param max 去掉首尾空白后的最大长度。
 * @returns 校验通过的文本。
 * @throws 值不是字符串、为空、超过最大长度或包含空字符时抛出 HTTP 400。
 */
export function readString(value: unknown, label: string, max: number) {
  if (typeof value !== "string") fail(400, `请填写${label}。`);
  const text = value.trim();
  if (!text || text.length > max || text.includes("\0")) {
    fail(400, `请检查${label}，长度应在 1 至 ${max} 个字符之间。`);
  }
  return text;
}

/**
 * 校验 ID 的 UUID 格式并统一为小写。
 * @param value 待校验的原始 ID。
 * @param label 错误提示中使用的字段名。
 * @returns 小写的 UUID 字符串。
 * @throws ID 格式无效时抛出 HTTP 400。
 */
export function readUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    fail(400, `${label}格式不正确。`);
  }
  return value.toLowerCase();
}

/**
 * 解析页码、每页条数等正整数查询参数。
 * @param value 查询参数原文，省略时为 `undefined`。
 * @param label 错误提示中使用的字段名。
 * @param fallback 参数省略时使用的默认值。
 * @param maximum 允许的最大值。
 * @returns 解析得到的整数，或参数省略时的默认值。
 * @throws 参数存在但不是纯数字表示的有效正整数，或超过上限时抛出 HTTP 400。
 */
export function readPositiveInteger(
  value: string | undefined,
  label: string,
  fallback: number,
  maximum: number
) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  ) {
    fail(400, `${label}须为 1 至 ${maximum} 的整数。`);
  }
  return number;
}

/**
 * 校验客户端提交的期望版本，供写入前与数据库中的版本比较。
 * @param value 客户端读取记录时取得的版本号。
 * @returns PostgreSQL `integer` 列可表示的正整数，即 1 至 2147483647。
 * @throws 版本缺失或不是范围内的整数时抛出 HTTP 400。
 */
export function readExpectedVersion(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    fail(400, "请提交有效的记录版本。");
  }
  return value;
}

/**
 * 在版本不匹配时中止写入，提供最新资料供客户端比较。
 * @param current 从数据库读取的当前记录快照。
 * @returns 无正常返回。
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
 * 判断错误是否来自指定的 PostgreSQL 约束。
 * @param error 捕获到的错误，可能包装了底层数据库错误。
 * @param code 要匹配的 SQLSTATE 错误码。
 * @param constraint 要匹配的数据库约束名。
 * @returns 所检查的错误对象同时匹配错误码和约束名时为 `true`，否则为 `false`。
 */
export function isConstraintError(
  error: unknown,
  code: string,
  constraint: string
) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code &&
    "constraint_name" in cause &&
    cause.constraint_name === constraint
  );
}
