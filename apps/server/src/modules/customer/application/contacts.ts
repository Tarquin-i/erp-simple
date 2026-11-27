import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";
import { customerContactMethodType } from "@repo/db/schema";
import {
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "../../shared/phone-number";
import { HTTPException } from "hono/http-exception";

import { ApplicationError, failVersionConflict } from "../../../errors";
import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { fail } from "../../../errors";
import {
  findNextPrimaryMethod,
  hasConflictingMethodType,
  planPrimaryMethodChange,
  preparePrimaryMethods,
  rememberContactMethod,
  shouldAddPrimaryMethod,
} from "../domain/contact-methods";
import { readString, readUuid } from "../../../http/request-input";
import {
  archiveContactRecord,
  clearPrimary,
  deleteContactMethod,
  findActiveContact,
  insertContact,
  insertContactMethod,
  listMethods,
  lockContactCreateRequest,
  lockContactForArchive,
  lockContactForChange,
  promoteMethod,
  replaceContactMethods,
  selectCustomerContacts,
  updateContactMethod,
  updateContactRecord,
} from "../persistence/contacts";
import type {
  Contact,
  Method,
  MethodInput,
  MethodType,
  SubmittedMethod,
} from "../persistence/contacts";
import { lockCustomerForWrite } from "../persistence/profile-write-access";
import { createCustomerError } from "./errors";

const methodFields = ["type", "value", "isPrimary"] as const;
const aggregateMethodFields = ["id", ...methodFields] as const;
const methodChangeFields = ["add", "update", "remove"] as const;
const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function readMethodType(value: unknown): MethodType {
  const type = customerContactMethodType.enumValues.find(
    (type) => type === value
  );
  if (!type) fail(400, "请选择有效的联系方式类型。");
  return type;
}

export function readPrimary(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    fail(400, "主要联系方式标记必须是布尔值。");
  }
  return value;
}

/**
 * 按联系方式类型校验并规范化输入。
 * @param type 已校验的联系方式类型。
 * @param raw 原始联系信息。
 * @returns 去掉首尾空格的内容。电话和 WhatsApp 返回 E.164 格式的手机号。
 * @throws 联系信息无效或手机号、邮箱格式不符时抛出 HTTP 400。
 */
function readMethodValue(type: MethodType, raw: unknown): string {
  const value = readString(raw, "联系方式", 320);
  if (type === "phone" || type === "whatsapp") {
    const mobile = normalizeMobilePhone(value);
    if (!mobile) fail(400, INVALID_MOBILE_PHONE_MESSAGE);
    return mobile;
  }
  if (type === "email" && !emailPattern.test(value)) {
    fail(400, "请输入有效的邮箱地址。");
  }
  return value;
}

export function readMethod(input: Record<string, unknown>): MethodInput {
  const type = readMethodType(input.type);
  return {
    type,
    value: readMethodValue(type, input.value),
    isPrimary: readPrimary(input.isPrimary),
  };
}

function readMethodFields(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "请检查填写的联系方式。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    fail(400, "联系方式含有不支持的字段。");
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
  if (!Array.isArray(value)) fail(400, "请检查填写的联系方式。");
  if (!current && value.length === 0) {
    fail(400, "请为联系人填写至少一种联系方式。");
  }

  const fields: readonly string[] = current
    ? aggregateMethodFields
    : methodFields;
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const methods = value.map((item: unknown) => {
    const input = readMethodFields(item, fields);
    const id =
      input.id === undefined ? undefined : readUuid(input.id, "联系方式 ID");
    const existing = id === undefined ? undefined : current?.get(id);
    if (id !== undefined) {
      if (!existing) fail(400, "包含不属于该联系人的联系方式。");
      if (seenIds.has(id)) fail(400, "同一条联系方式不能重复提交。");
      seenIds.add(id);
    }
    const type = readMethodType(input.type);
    const value =
      existing && type === existing.type && input.value === existing.value
        ? existing.value
        : readMethodValue(type, input.value);
    const isPrimary = readPrimary(input.isPrimary);
    if (current && isPrimary === undefined) {
      fail(400, "请标明每条联系方式是否为主要联系方式。");
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
  if (!Array.isArray(value)) fail(400, "请提交有效的联系方式变更列表。");
  return value;
}

/** 将变更合入加锁后的资料，由整组保存统一校验最终状态。 */
function mergeMethodChanges(value: unknown, current: Method[]) {
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
    const id = readUuid(value, "联系方式 ID");
    if (changedIds.has(id)) fail(400, "同一条联系方式不能重复提交。");
    if (!methods.has(id)) fail(400, "包含不属于该联系人的联系方式。");
    changedIds.add(id);
    return id;
  }

  for (const item of updated) {
    const input = readMethodFields(item, aggregateMethodFields);
    const id = readChangedId(input.id);
    if (methodFields.every((field) => input[field] === undefined)) {
      fail(400, "请填写要修改的联系方式字段。");
    }
    methods.set(id, { ...methods.get(id), ...input, id });
  }
  for (const item of removed) methods.delete(readChangedId(item));

  return [
    ...methods.values(),
    ...added.map((item) => readMethodFields(item, methodFields)),
  ];
}

interface ContactMethodPatch {
  type?: MethodType;
  value?: unknown;
  isPrimary?: boolean;
  restorePrimaryMethodId?: string;
  strictVersion: boolean;
  expectedMethodVersion?: number;
  expectedContactVersion?: number;
}

export function createContactUseCases(db: Database) {
  // 写入顺序为部门、客户、联系人。单条编辑在持锁后校验自己的版本。
  async function changeContact(
    access: AccountRecordAccess,
    customerId: string,
    contactId: string,
    expectedContactVersion: number | undefined,
    change: (
      tx: DatabaseTransaction,
      lockedContact: Contact
    ) => Promise<undefined | { name: string } | { methods: Method[] }>
  ) {
    try {
      return await db.transaction(async (tx) => {
        await lockCustomerForWrite(tx, access, customerId);
        const locked = await lockContactForChange(tx, customerId, contactId);
        if (!locked) throw createCustomerError("contactNotFound");
        if (
          expectedContactVersion !== undefined &&
          locked.version !== expectedContactVersion
        ) {
          failVersionConflict({
            ...locked,
            methods: await listMethods(tx, contactId),
          });
        }

        const fields = await change(tx, locked);
        if (fields && "methods" in fields) {
          return { ...locked, methods: fields.methods };
        }
        const contact = await updateContactRecord(
          tx,
          customerId,
          contactId,
          fields?.name
        );
        return { ...contact, methods: await listMethods(tx, contactId) };
      });
    } catch (error) {
      if (
        isConstraintError(
          error,
          "23505",
          "customer_contact_method_email_unique"
        )
      ) {
        throw createCustomerError("contactDuplicateEmail");
      }
      if (
        isConstraintError(
          error,
          "23505",
          "customer_contact_method_non_email_type_unique"
        )
      ) {
        throw createCustomerError("contactDuplicateType");
      }
      throw error;
    }
  }

  return {
    listContacts(access: AccountRecordAccess, customerId: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          const contacts = await selectCustomerContacts(
            tx,
            currentAccess,
            customerId
          );
          if (!contacts) throw createCustomerError("profileNotFound");
          return contacts;
        },
        db
      );
    },

    createContact(
      access: AccountRecordAccess,
      customerId: string,
      name: string,
      methods: MethodInput[],
      requestId: string
    ) {
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            customerId,
            name,
            methods: methods.toSorted(
              (a, b) =>
                customerContactMethodType.enumValues.indexOf(a.type) -
                  customerContactMethodType.enumValues.indexOf(b.type) ||
                a.value.localeCompare(b.value)
            ),
          })
        )
        .digest("hex");

      return db.transaction(async (tx) => {
        const existing = await lockContactCreateRequest(
          tx,
          access.userId,
          requestId
        );
        await lockCustomerForWrite(
          tx,
          access,
          existing?.customerId ?? customerId
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApplicationError(
              409,
              "该提交 ID 已用于不同的联系人内容。",
              { code: "idempotency_conflict" }
            );
          }
          // 在取得客户锁后读取当前快照，兼容同一提交的重试。
          const contact = await findActiveContact(tx, existing.id);
          if (!contact) throw createCustomerError("contactNotFound");
          return { ...contact, methods: await listMethods(tx, contact.id) };
        }

        const contact = await insertContact(
          tx,
          {
            customerId,
            name,
            creationActorUserId: access.userId,
            creationRequestId: requestId,
            creationRequestHash: requestHash,
          },
          methods
        );
        return { ...contact, methods: await listMethods(tx, contact.id) };
      });
    },

    updateContact(
      access: AccountRecordAccess,
      customerId: string,
      contactId: string,
      expectedVersion: number,
      {
        name,
        methods,
        methodChanges,
      }: { name?: string; methods?: unknown; methodChanges?: unknown }
    ) {
      return changeContact(
        access,
        customerId,
        contactId,
        expectedVersion,
        async (tx, lockedContact) => {
          const nextName = name ?? lockedContact.name;
          if (methods === undefined && methodChanges === undefined) {
            return { name: nextName };
          }
          const current = await listMethods(tx, contactId);
          const nextMethods =
            methodChanges === undefined
              ? methods
              : mergeMethodChanges(methodChanges, current);
          const changed =
            nextMethods !== undefined &&
            (await replaceContactMethods(
              tx,
              contactId,
              current,
              readContactMethods(
                nextMethods,
                new Map(current.map((method) => [method.id, method]))
              )
            ));
          return changed || nextName !== lockedContact.name
            ? { name: nextName }
            : { methods: current };
        }
      );
    },

    archiveContact(
      access: AccountRecordAccess,
      customerId: string,
      contactId: string,
      expectedVersion: number
    ) {
      return db.transaction(async (tx) => {
        const { access: current, record: owner } = await lockCustomerForWrite(
          tx,
          access,
          customerId,
          "no key update",
          true
        );
        const contact = await lockContactForArchive(tx, customerId, contactId);
        if (!contact) throw createCustomerError("contactNotFound");

        if (contact.archivedAt) {
          if (contact.version !== expectedVersion + 1) {
            throw createCustomerError("contactNotFound");
          }
          return {
            id: contact.id,
            version: contact.version,
            archivedAt: contact.archivedAt,
          };
        }
        if (owner.status === "archived") {
          throw createCustomerError("contactNotFound");
        }
        if (contact.version !== expectedVersion) {
          failVersionConflict({
            ...contact,
            methods: await listMethods(tx, contactId),
          });
        }

        const archivedAt = new Date();
        await archiveContactRecord(
          tx,
          customerId,
          contactId,
          current.userId,
          archivedAt
        );
        return { id: contact.id, version: contact.version + 1, archivedAt };
      });
    },

    addMethod(
      access: AccountRecordAccess,
      customerId: string,
      contactId: string,
      expectedVersion: number,
      method: MethodInput
    ) {
      return changeContact(
        access,
        customerId,
        contactId,
        expectedVersion,
        async (tx) => {
          const methods = await listMethods(tx, contactId);
          const isPrimary = shouldAddPrimaryMethod(methods, method.isPrimary);
          if (isPrimary) await clearPrimary(tx, contactId);
          await insertContactMethod(tx, contactId, { ...method, isPrimary });
          return undefined;
        }
      );
    },

    updateMethod(
      access: AccountRecordAccess,
      customerId: string,
      contactId: string,
      methodId: string,
      {
        type,
        value: rawValue,
        isPrimary,
        restorePrimaryMethodId,
        strictVersion,
        expectedMethodVersion,
        expectedContactVersion,
      }: ContactMethodPatch
    ) {
      return changeContact(
        access,
        customerId,
        contactId,
        undefined,
        async (tx, lockedContact) => {
          const methods = await listMethods(tx, contactId);
          const current = methods.find((method) => method.id === methodId);
          let value: string | undefined;
          let valueError: HTTPException | undefined;
          if (
            !strictVersion &&
            current &&
            (current.type === "phone" || current.type === "whatsapp") &&
            rawValue !== undefined &&
            (type === undefined || type === current.type) &&
            (isPrimary === undefined || isPrimary === current.isPrimary)
          ) {
            // 同一号码已保存时直接返回快照，其他旧请求仍优先报版本冲突。
            try {
              value = readMethodValue(current.type, rawValue);
            } catch (error) {
              if (!(error instanceof HTTPException) || error.status !== 400) {
                throw error;
              }
              valueError = error;
            }
            if (value === current.value) return { methods };
          }
          if (
            expectedContactVersion !== undefined &&
            lockedContact.version !== expectedContactVersion
          ) {
            failVersionConflict({ ...lockedContact, methods });
          }
          if (!current) {
            throw new ApplicationError(404, "联系方式不存在。", {
              code: "contact_method_not_found",
              current: { ...lockedContact, methods },
            });
          }
          if (
            expectedMethodVersion !== undefined &&
            current.version !== expectedMethodVersion
          ) {
            failVersionConflict({ ...lockedContact, methods });
          }
          if (
            type !== undefined &&
            hasConflictingMethodType(methods, methodId, type)
          ) {
            if (restorePrimaryMethodId) {
              fail(409, "旧联系方式类型已被其他记录占用，无法写回。");
            }
            failVersionConflict({ ...lockedContact, methods });
          }
          const restoredPrimary = restorePrimaryMethodId
            ? methods.find((method) => method.id === restorePrimaryMethodId)
            : undefined;
          if (restorePrimaryMethodId && !restoredPrimary) {
            fail(409, "原主要联系方式已被删除，无法写回旧值。");
          }
          if (valueError) throw valueError;
          if (
            value === undefined &&
            (type !== undefined || rawValue !== undefined)
          ) {
            if (
              restoredPrimary &&
              type === current.type &&
              rawValue === current.value
            ) {
              // 兼容仅恢复主要项的旧号码。
              value = current.value;
            } else {
              value = readMethodValue(
                type ?? current.type,
                rawValue === undefined ? current.value : rawValue
              );
              // 写回旧值时保留原大陆本地号码格式。
              if (
                restoredPrimary &&
                typeof rawValue === "string" &&
                value === `+86${rawValue}`
              ) {
                value = rawValue;
              }
            }
          }

          const plan = planPrimaryMethodChange(
            methods,
            current,
            isPrimary,
            restoredPrimary
          );
          if (!plan.ok) throw createCustomerError(plan.reason);
          if (plan.clearPrevious) await clearPrimary(tx, contactId, methodId);
          await updateContactMethod(tx, contactId, methodId, {
            type,
            value,
            isPrimary: plan.primary,
          });
          if (plan.replacementId) {
            await promoteMethod(tx, contactId, plan.replacementId);
          }
          return undefined;
        }
      );
    },

    deleteMethod(
      access: AccountRecordAccess,
      customerId: string,
      contactId: string,
      methodId: string,
      expectedVersion: number
    ) {
      return changeContact(
        access,
        customerId,
        contactId,
        expectedVersion,
        async (tx) => {
          const deleted = await deleteContactMethod(tx, contactId, methodId);
          if (!deleted) fail(404, "联系方式不存在。");

          if (deleted.isPrimary) {
            const next = findNextPrimaryMethod(
              await listMethods(tx, contactId)
            );
            if (next) await promoteMethod(tx, contactId, next.id);
          }
          return undefined;
        }
      );
    },
  };
}
