import { customerContactMethodType } from "@repo/db/schema";

import { ModuleError } from "../../shared/application-error";
import {
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "../../shared/phone-number";
import { validateRequiredText } from "../../shared/required-text";
import { normalizeUuid } from "../../shared/uuid";
import {
  preparePrimaryMethods,
  rememberContactMethod,
} from "../domain/contact-methods";
import type {
  Method,
  MethodType,
  SubmittedMethod,
} from "../persistence/contacts";
import { createCustomerError } from "./errors";

const methodFields = ["type", "value", "isPrimary"] as const;
const aggregateMethodFields = ["id", ...methodFields] as const;
const methodChangeFields = ["add", "update", "remove"] as const;
const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function invalidContactMethods(message: string): never {
  throw new ModuleError("customer", "contactMethodsInvalid", message);
}

function invalidContactMethodValue(message: string): never {
  throw new ModuleError("customer", "contactMethodValueInvalid", message);
}

function readMethodId(value: unknown) {
  const id = normalizeUuid(value);
  if (id === undefined) invalidContactMethods("联系方式 ID格式不正确。");
  return id;
}

export function readMethodType(value: unknown): MethodType {
  const type = customerContactMethodType.enumValues.find(
    (type) => type === value
  );
  if (!type) invalidContactMethods("请选择有效的联系方式类型。");
  return type;
}

export function readPrimary(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    invalidContactMethods("主要联系方式标记必须是布尔值。");
  }
  return value;
}

/**
 * 按联系方式类型校验并规范化输入。
 * @param type 已校验的联系方式类型。
 * @param raw 原始联系信息。
 * @returns 去掉首尾空格的内容。电话和 WhatsApp 返回 E.164 格式的手机号。
 * @throws 联系信息无效或手机号、邮箱格式不符时抛出联系方式值错误。
 */
export function readMethodValue(type: MethodType, raw: unknown): string {
  const text = validateRequiredText(raw, "联系方式", 320);
  if (!text.ok) invalidContactMethodValue(text.message);
  const value = text.value;
  if (type === "phone" || type === "whatsapp") {
    const mobile = normalizeMobilePhone(value);
    if (!mobile) invalidContactMethodValue(INVALID_MOBILE_PHONE_MESSAGE);
    return mobile;
  }
  if (type === "email" && !emailPattern.test(value)) {
    invalidContactMethodValue("请输入有效的邮箱地址。");
  }
  return value;
}

function readMethodFields(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidContactMethods("请检查填写的联系方式。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    invalidContactMethods("联系方式含有不支持的字段。");
  }
  return input;
}

/**
 * 校验整组联系方式。新建时默认首项为主要；编辑时保留未修改的历史资料。
 * @param value 原始联系方式数组。
 * @param current 编辑时传已锁定联系人的现有联系方式，新建时省略。
 * @returns 校验后的联系方式列表。非空列表恰有一条主要方式。
 */
export function readContactMethods(
  value: unknown,
  current?: ReadonlyMap<string, Method>
): SubmittedMethod[] {
  if (!Array.isArray(value)) invalidContactMethods("请检查填写的联系方式。");
  if (!current && value.length === 0) {
    invalidContactMethods("请为联系人填写至少一种联系方式。");
  }

  const fields: readonly string[] = current
    ? aggregateMethodFields
    : methodFields;
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const methods = value.map((item: unknown) => {
    const input = readMethodFields(item, fields);
    const id = input.id === undefined ? undefined : readMethodId(input.id);
    const existing = id === undefined ? undefined : current?.get(id);
    if (id !== undefined) {
      if (!existing) invalidContactMethods("包含不属于该联系人的联系方式。");
      if (seenIds.has(id))
        invalidContactMethods("同一条联系方式不能重复提交。");
      seenIds.add(id);
    }
    const type = readMethodType(input.type);
    const value =
      existing && type === existing.type && input.value === existing.value
        ? existing.value
        : readMethodValue(type, input.value);
    const isPrimary = readPrimary(input.isPrimary);
    if (current && isPrimary === undefined) {
      invalidContactMethods("请标明每条联系方式是否为主要联系方式。");
    }
    const method = { id, type, value, isPrimary };
    const reason = rememberContactMethod(seenKeys, method);
    if (reason) throw createCustomerError(reason);
    return method;
  });
  const result = preparePrimaryMethods(methods, current !== undefined);
  if (!result.ok) throw createCustomerError(result.reason);
  return result.methods;
}

function readMethodChangeList(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    invalidContactMethods("请提交有效的联系方式变更列表。");
  }
  return value;
}

/** 将变更合入加锁后的资料，由整组保存统一校验最终状态。 */
export function mergeMethodChanges(value: unknown, current: Method[]) {
  const changes = readMethodFields(value, methodChangeFields);
  const added = readMethodChangeList(changes.add);
  const updated = readMethodChangeList(changes.update);
  const removed = readMethodChangeList(changes.remove);
  if (!added.length && !updated.length && !removed.length) return;

  const methods = new Map<string, Record<string, unknown>>(
    current.map(({ id, type, value, isPrimary }) => [
      id,
      { id, type, value, isPrimary },
    ])
  );
  const changedIds = new Set<string>();

  function readChangedId(value: unknown) {
    const id = readMethodId(value);
    if (changedIds.has(id))
      invalidContactMethods("同一条联系方式不能重复提交。");
    if (!methods.has(id))
      invalidContactMethods("包含不属于该联系人的联系方式。");
    changedIds.add(id);
    return id;
  }

  for (const item of updated) {
    const input = readMethodFields(item, aggregateMethodFields);
    const id = readChangedId(input.id);
    if (methodFields.every((field) => input[field] === undefined)) {
      invalidContactMethods("请填写要修改的联系方式字段。");
    }
    methods.set(id, { ...methods.get(id), ...input, id });
  }
  for (const item of removed) methods.delete(readChangedId(item));

  return [
    ...methods.values(),
    ...added.map((item) => readMethodFields(item, methodFields)),
  ];
}
