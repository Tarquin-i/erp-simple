import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { fail } from "../organization/errors";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

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

export function readString(value: unknown, label: string, max: number) {
  if (typeof value !== "string") fail(400, `请填写${label}。`);
  const text = value.trim();
  if (!text || text.length > max || text.includes("\0")) {
    fail(400, `请检查${label}，长度应在 1 至 ${max} 个字符之间。`);
  }
  return text;
}

export function readUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    fail(400, `${label}格式不正确。`);
  }
  return value.toLowerCase();
}

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
