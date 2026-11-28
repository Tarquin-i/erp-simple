import type { Context } from "hono";

import { fail } from "../../../errors";
import {
  readExpectedVersion,
  readObject,
  readString,
  readUuid,
} from "../../../http/request-input";
import {
  readContactMethods,
  readMethodType,
  readMethodValue,
  readPrimary,
} from "../application/contact-method-changes";

const methodFields = ["type", "value", "isPrimary"] as const;
const versionedMethodFields = [...methodFields, "expectedVersion"] as const;
const methodEditFields = [
  ...versionedMethodFields,
  "expectedMethodVersion",
  "expectedContactVersion",
  "requireCurrentVersion",
  "restorePrimaryMethodId",
] as const;

export async function readContactCreateRequest(c: Context) {
  const body = await readObject(c, ["name", "methods"]);
  const name = readString(body.name, "联系人姓名", 128);
  const methods = readContactMethods(body.methods);
  const requestId = readUuid(c.req.header("Idempotency-Key"), "提交 ID");
  return { name, methods, requestId };
}

export async function readContactUpdateRequest(c: Context) {
  const body = await readObject(c, [
    "name",
    "expectedVersion",
    "methods",
    "methodChanges",
  ]);
  const { methods, methodChanges } = body;
  if (methods !== undefined && methodChanges !== undefined) {
    fail(400, "请使用同一种联系方式提交方式。");
  }
  const name =
    body.name === undefined && methodChanges !== undefined
      ? undefined
      : readString(body.name, "联系人姓名", 128);
  const expectedVersion = readExpectedVersion(body.expectedVersion);

  // 内层联系方式由用例在核对锁定记录的版本后校验。
  return { expectedVersion, update: { name, methods, methodChanges } };
}

export function readContactQueryVersion(version: string | undefined) {
  return readExpectedVersion(
    version && /^\d+$/.test(version) ? Number(version) : undefined
  );
}

export async function readContactMethodCreateRequest(c: Context) {
  const body = await readObject(c, versionedMethodFields);
  const type = readMethodType(body.type);
  const method = {
    type,
    value: readMethodValue(type, body.value),
    isPrimary: readPrimary(body.isPrimary),
  };
  const expectedVersion = readExpectedVersion(body.expectedVersion);
  return { expectedVersion, method };
}

export async function readContactMethodUpdateRequest(c: Context) {
  const body = await readObject(c, methodEditFields);
  if (methodFields.every((field) => body[field] === undefined))
    fail(400, "请填写要修改的联系方式字段。");

  const type = body.type === undefined ? undefined : readMethodType(body.type);
  const isPrimary = readPrimary(body.isPrimary);
  const restorePrimaryMethodId =
    body.restorePrimaryMethodId === undefined
      ? undefined
      : readUuid(body.restorePrimaryMethodId, "原主要联系方式 ID");
  if (
    body.requireCurrentVersion !== undefined &&
    body.requireCurrentVersion !== true
  ) {
    fail(400, "严格版本校验标记必须为 true。");
  }
  const strictVersion =
    restorePrimaryMethodId !== undefined || body.requireCurrentVersion === true;
  // 旧页面提交的是联系人版本，单独命名新字段以免把旧版本误当作单条版本。
  const legacyVersion = body.expectedVersion !== undefined;
  if (
    restorePrimaryMethodId &&
    (legacyVersion ||
      type === undefined ||
      body.value === undefined ||
      isPrimary !== undefined)
  ) {
    fail(400, "写回旧值时须提供旧类型、旧联系信息和两个当前版本。");
  }
  if (
    legacyVersion &&
    (body.expectedMethodVersion !== undefined ||
      body.expectedContactVersion !== undefined)
  ) {
    fail(400, "请使用同一种版本校验方式。");
  }
  const expectedMethodVersion = legacyVersion
    ? undefined
    : readExpectedVersion(body.expectedMethodVersion);
  const expectedContactVersion =
    legacyVersion || isPrimary !== undefined || restorePrimaryMethodId
      ? readExpectedVersion(
          legacyVersion ? body.expectedVersion : body.expectedContactVersion
        )
      : undefined;

  return {
    type,
    value: body.value,
    isPrimary,
    restorePrimaryMethodId,
    strictVersion,
    expectedMethodVersion,
    expectedContactVersion,
  };
}
