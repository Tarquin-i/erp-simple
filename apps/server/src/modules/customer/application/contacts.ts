import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";
import { customerContactMethodType } from "@repo/db/schema";
import { HTTPException } from "hono/http-exception";

import { ApplicationError, fail, failVersionConflict } from "../../../errors";
import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import {
  findNextPrimaryMethod,
  hasConflictingMethodType,
  planPrimaryMethodChange,
  shouldAddPrimaryMethod,
} from "../domain/contact-methods";
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
} from "../persistence/contacts";
import { lockCustomerForWrite } from "../persistence/profile-write-access";
import {
  mergeMethodChanges,
  readContactMethods,
  readMethodValue,
} from "./contact-method-changes";
import { createCustomerError } from "./errors";

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
