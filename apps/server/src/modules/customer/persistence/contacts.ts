import type { DatabaseTransaction } from "@repo/db";
import {
  customer,
  customerContact,
  customerContactMethod,
} from "@repo/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { recordScopeWhere } from "../../organization";
import type { AccountRecordAccess } from "../../organization";

const contactColumns = {
  id: customerContact.id,
  customerId: customerContact.customerId,
  name: customerContact.name,
  version: customerContact.version,
  createdAt: customerContact.createdAt,
  updatedAt: customerContact.updatedAt,
};

const methodColumns = {
  id: customerContactMethod.id,
  contactId: customerContactMethod.contactId,
  type: customerContactMethod.type,
  value: customerContactMethod.value,
  isPrimary: customerContactMethod.isPrimary,
  version: customerContactMethod.version,
  createdAt: customerContactMethod.createdAt,
  updatedAt: customerContactMethod.updatedAt,
};

export type Contact = Pick<
  typeof customerContact.$inferSelect,
  keyof typeof contactColumns
>;
export type Method = Pick<
  typeof customerContactMethod.$inferSelect,
  keyof typeof methodColumns
>;
type ContactWithMethods = Contact & { methods: Method[] };
export type MethodType = Method["type"];
export type MethodInput = Pick<Method, "type" | "value"> & {
  isPrimary?: boolean;
};
export type SubmittedMethod = MethodInput & { id?: string };

export async function selectCustomerContacts(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  customerId: string
) {
  const rows = await tx
    .select({ contact: contactColumns, method: methodColumns })
    .from(customer)
    .leftJoin(
      customerContact,
      and(
        eq(customerContact.customerId, customer.id),
        isNull(customerContact.archivedAt)
      )
    )
    .leftJoin(
      customerContactMethod,
      eq(customerContactMethod.contactId, customerContact.id)
    )
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.status, "active"),
        recordScopeWhere(access, customer)
      )
    )
    .orderBy(
      asc(customerContact.createdAt),
      asc(customerContact.id),
      desc(customerContactMethod.isPrimary),
      asc(customerContactMethod.createdAt),
      asc(customerContactMethod.id)
    );
  if (!rows.length) return;

  const contacts = new Map<string, ContactWithMethods>();
  for (const { contact, method } of rows) {
    if (!contact) continue;
    let entry = contacts.get(contact.id);
    if (!entry) {
      entry = { ...contact, methods: [] };
      contacts.set(contact.id, entry);
    }
    if (method) entry.methods.push(method);
  }
  return [...contacts.values()];
}

/**
 * 读取联系人的联系方式。主要项排在最前，其余按创建时间和 ID 升序排列，供主要项递补使用。
 * @param tx 调用方已经开启的事务。
 * @param contactId 联系人 ID。
 * @returns 按上述顺序排列的联系方式，没有记录时返回空数组。
 */
export async function listMethods(tx: DatabaseTransaction, contactId: string) {
  return tx
    .select(methodColumns)
    .from(customerContactMethod)
    .where(eq(customerContactMethod.contactId, contactId))
    .orderBy(
      desc(customerContactMethod.isPrimary),
      asc(customerContactMethod.createdAt),
      asc(customerContactMethod.id)
    );
}

export async function replaceContactMethods(
  tx: DatabaseTransaction,
  contactId: string,
  current: Method[],
  methods: SubmittedMethod[]
) {
  const existingById = new Map(current.map((method) => [method.id, method]));
  const retainedIds = new Set(methods.map((method) => method.id));
  const removedIds = current
    .filter(({ id }) => !retainedIds.has(id))
    .map(({ id }) => id);
  const writes: (typeof customerContactMethod.$inferInsert)[] = [];
  const updatedAt = new Date();

  for (const { id, ...method } of methods) {
    const existing = id === undefined ? undefined : existingById.get(id);
    if (!existing) {
      writes.push({ ...method, contactId });
    } else if (
      existing.type !== method.type ||
      existing.value !== method.value ||
      existing.isPrimary !== method.isPrimary
    ) {
      removedIds.push(existing.id);
      writes.push({
        ...existing,
        ...method,
        version: existing.version + 1,
        updatedAt,
      });
    }
  }

  // 先在事务内腾出旧的唯一键，再以原 ID 写回变更项，允许互换邮箱、类型或主要项。
  if (removedIds.length) {
    await tx
      .delete(customerContactMethod)
      .where(
        and(
          eq(customerContactMethod.contactId, contactId),
          inArray(customerContactMethod.id, removedIds)
        )
      );
  }
  if (writes.length) await tx.insert(customerContactMethod).values(writes);
  return removedIds.length > 0 || writes.length > 0;
}

export async function lockContactCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  // 同一账号的同一次提交排队，避免并发重试分别创建联系人。
  const lockKey = JSON.stringify([
    "customer-contact-create",
    userId,
    requestId,
  ]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  );
  const [existing] = await tx
    .select({
      id: customerContact.id,
      customerId: customerContact.customerId,
      requestHash: customerContact.creationRequestHash,
    })
    .from(customerContact)
    .where(
      and(
        eq(customerContact.creationActorUserId, userId),
        eq(customerContact.creationRequestId, requestId)
      )
    );
  return existing;
}

export async function findActiveContact(tx: DatabaseTransaction, id: string) {
  const [contact] = await tx
    .select(contactColumns)
    .from(customerContact)
    .where(and(eq(customerContact.id, id), isNull(customerContact.archivedAt)));
  return contact;
}

export async function insertContact(
  tx: DatabaseTransaction,
  values: typeof customerContact.$inferInsert,
  methods: MethodInput[]
) {
  const [contact] = await tx
    .insert(customerContact)
    .values(values)
    .returning(contactColumns);
  await tx
    .insert(customerContactMethod)
    .values(methods.map((method) => ({ ...method, contactId: contact.id })));
  return contact;
}

function scopedContact(customerId: string, contactId: string) {
  return and(
    eq(customerContact.customerId, customerId),
    eq(customerContact.id, contactId)
  );
}

export async function lockContactForChange(
  tx: DatabaseTransaction,
  customerId: string,
  contactId: string
) {
  // 读取或变更主要联系方式前，先让同一联系人的并发更新排队。
  const [contact] = await tx
    .select(contactColumns)
    .from(customerContact)
    .where(
      and(
        eq(customerContact.customerId, customerId),
        eq(customerContact.id, contactId),
        isNull(customerContact.archivedAt)
      )
    )
    .for("update");
  return contact;
}

export async function updateContactRecord(
  tx: DatabaseTransaction,
  customerId: string,
  contactId: string,
  name?: string
) {
  const [contact] = await tx
    .update(customerContact)
    .set({
      name,
      updatedAt: new Date(),
      version: sql`${customerContact.version} + 1`,
    })
    .where(
      and(
        eq(customerContact.id, contactId),
        eq(customerContact.customerId, customerId)
      )
    )
    .returning(contactColumns);
  return contact;
}

export async function lockContactForArchive(
  tx: DatabaseTransaction,
  customerId: string,
  contactId: string
) {
  const [contact] = await tx
    .select({ ...contactColumns, archivedAt: customerContact.archivedAt })
    .from(customerContact)
    .where(scopedContact(customerId, contactId))
    .for("update");
  return contact;
}

function contactArchiveFields(actorUserId: string, archivedAt: Date) {
  return {
    archivedAt,
    archivedByUserId: actorUserId,
    updatedAt: archivedAt,
    version: sql`${customerContact.version} + 1`,
  };
}

export async function archiveContactRecord(
  tx: DatabaseTransaction,
  customerId: string,
  contactId: string,
  userId: string,
  archivedAt: Date
) {
  await tx
    .update(customerContact)
    .set(contactArchiveFields(userId, archivedAt))
    .where(scopedContact(customerId, contactId));
}

/** 在客户锁内归档联系人组，联系方式通过所属联系人退出业务查询。 */
export async function archiveCustomerContacts(
  tx: DatabaseTransaction,
  customerId: string,
  actorUserId: string,
  archivedAt: Date
) {
  await tx
    .update(customerContact)
    .set(contactArchiveFields(actorUserId, archivedAt))
    .where(
      and(
        eq(customerContact.customerId, customerId),
        isNull(customerContact.archivedAt)
      )
    );
}

function scopedMethod(contactId: string, methodId: string) {
  return and(
    eq(customerContactMethod.contactId, contactId),
    eq(customerContactMethod.id, methodId)
  );
}

/**
 * 取消当前主要联系方式，准备在同一事务中设置新的主要项。
 * @param tx 已锁定联系人的事务。
 * @param contactId 联系人 ID。
 * @param exceptId 要保留原标记的联系方式 ID。
 * @returns 更新完成后结束，无返回数据。
 */
export async function clearPrimary(
  tx: DatabaseTransaction,
  contactId: string,
  exceptId?: string
) {
  await tx
    .update(customerContactMethod)
    .set({
      isPrimary: false,
      version: sql`${customerContactMethod.version} + 1`,
    })
    .where(
      and(
        eq(customerContactMethod.contactId, contactId),
        eq(customerContactMethod.isPrimary, true),
        exceptId ? ne(customerContactMethod.id, exceptId) : undefined
      )
    );
}

/**
 * 将指定联系方式设为主要项。
 * @param tx 已锁定联系人的事务。调用方须先在该事务内取消或删除原主要项。
 * @param contactId 联系人 ID。
 * @param methodId 要设为主要项的联系方式 ID。
 * @returns 更新完成后结束，无返回数据。
 * @throws 仍有另一条主要项时，数据库唯一约束会拒绝更新。
 */
export async function promoteMethod(
  tx: DatabaseTransaction,
  contactId: string,
  methodId: string
) {
  await tx
    .update(customerContactMethod)
    .set({
      isPrimary: true,
      version: sql`${customerContactMethod.version} + 1`,
    })
    .where(scopedMethod(contactId, methodId));
}

export async function insertContactMethod(
  tx: DatabaseTransaction,
  contactId: string,
  method: MethodInput
) {
  await tx.insert(customerContactMethod).values({ ...method, contactId });
}

export async function updateContactMethod(
  tx: DatabaseTransaction,
  contactId: string,
  methodId: string,
  fields: Partial<MethodInput>
) {
  await tx
    .update(customerContactMethod)
    .set({
      ...fields,
      version: sql`${customerContactMethod.version} + 1`,
    })
    .where(scopedMethod(contactId, methodId));
}

export async function deleteContactMethod(
  tx: DatabaseTransaction,
  contactId: string,
  methodId: string
) {
  const [deleted] = await tx
    .delete(customerContactMethod)
    .where(scopedMethod(contactId, methodId))
    .returning({ isPrimary: customerContactMethod.isPrimary });
  return deleted;
}
