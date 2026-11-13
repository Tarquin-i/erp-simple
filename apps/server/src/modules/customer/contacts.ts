import {
  customer,
  customerContact,
  customerContactMethod,
  customerContactMethodType,
} from "@repo/db/schema";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";

import { businessScopeWhere } from "../business/access";
import type { BusinessAccess, BusinessAccessEnv } from "../business/access";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { lockCustomerForWrite } from "./records";
import {
  failVersionConflict,
  isConstraintError,
  readExpectedVersion,
  readObject,
  readString,
  readUuid,
} from "./input";

type Contact = typeof customerContact.$inferSelect;
type Method = typeof customerContactMethod.$inferSelect;
type ContactWithMethods = Contact & { methods: Method[] };
type MethodType = Method["type"];
type MethodInput = Pick<Method, "type" | "value"> & { isPrimary?: boolean };

const methodFields = ["type", "value", "isPrimary"] as const;
const versionedMethodFields = [...methodFields, "expectedVersion"] as const;
const mainlandMobilePattern = /^(?:\+86[ -]?)?(1[3-9]\d{9})$/;
const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function readMethodType(value: unknown): MethodType {
  const type = customerContactMethodType.enumValues.find(
    (type) => type === value
  );
  if (!type) fail(400, "请选择有效的联系方式类型。");
  return type;
}

function readPrimary(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    fail(400, "主要联系方式标记必须是布尔值。");
  }
  return value;
}

function readMethodValue(type: MethodType, raw: unknown): string {
  const value = readString(raw, "联系方式", 320);
  if (type === "phone" || type === "whatsapp") {
    const mobile = mainlandMobilePattern.exec(value)?.[1];
    if (!mobile) fail(400, "请输入有效的中国大陆手机号码。");
    return mobile;
  }
  if (type === "email" && !emailPattern.test(value)) {
    fail(400, "请输入有效的邮箱地址。");
  }
  return value;
}

function readMethod(input: Record<string, unknown>): MethodInput {
  const type = readMethodType(input.type);
  return {
    type,
    value: readMethodValue(type, input.value),
    isPrimary: readPrimary(input.isPrimary),
  };
}

function readNewContactMethods(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > customerContactMethodType.enumValues.length
  ) {
    fail(400, "请为联系人填写至少一种联系方式，每种类型最多一条。");
  }

  const methods = value.map((item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      fail(400, "请检查填写的联系方式。");
    }
    const input = item as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) => !methodFields.some((field) => field === key)
      )
    ) {
      fail(400, "联系方式含有不支持的字段。");
    }
    return readMethod(input);
  });
  if (new Set(methods.map((method) => method.type)).size !== methods.length) {
    fail(409, "同一联系人每种联系方式最多一条。");
  }
  if (methods.filter((method) => method.isPrimary).length > 1) {
    fail(400, "每个联系人只能有一个主要联系方式。");
  }

  const explicitPrimary = methods.findIndex((method) => method.isPrimary);
  const primaryIndex = explicitPrimary < 0 ? 0 : explicitPrimary;
  return methods.map((method, index) => ({
    ...method,
    isPrimary: index === primaryIndex,
  }));
}

function scopedCustomer(access: BusinessAccess, customerId: string) {
  return and(eq(customer.id, customerId), businessScopeWhere(access, customer));
}

async function listContacts(access: BusinessAccess, customerId: string) {
  const rows = await database.db
    .select({ contact: customerContact, method: customerContactMethod })
    .from(customer)
    .leftJoin(customerContact, eq(customerContact.customerId, customer.id))
    .leftJoin(
      customerContactMethod,
      eq(customerContactMethod.contactId, customerContact.id)
    )
    .where(scopedCustomer(access, customerId))
    .orderBy(
      asc(customerContact.createdAt),
      asc(customerContact.id),
      desc(customerContactMethod.isPrimary),
      asc(customerContactMethod.createdAt),
      asc(customerContactMethod.id)
    );
  if (!rows.length) fail(404, "客户不存在。");

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

async function listMethods(tx: DatabaseTransaction, contactId: string) {
  return tx
    .select()
    .from(customerContactMethod)
    .where(eq(customerContactMethod.contactId, contactId))
    .orderBy(
      desc(customerContactMethod.isPrimary),
      asc(customerContactMethod.createdAt),
      asc(customerContactMethod.id)
    );
}

async function createContact(
  access: BusinessAccess,
  customerId: string,
  name: string,
  methods: MethodInput[]
) {
  return database.db.transaction(async (tx) => {
    await lockCustomerForWrite(tx, access, customerId);

    const [contact] = await tx
      .insert(customerContact)
      .values({ customerId, name })
      .returning();
    await tx
      .insert(customerContactMethod)
      .values(methods.map((method) => ({ ...method, contactId: contact.id })));
    return { ...contact, methods: await listMethods(tx, contact.id) };
  });
}

async function changeContact(
  access: BusinessAccess,
  customerId: string,
  contactId: string,
  expectedVersion: number,
  change: (tx: DatabaseTransaction) => Promise<void | { name: string }>
) {
  try {
    return await database.db.transaction(async (tx) => {
      await lockCustomerForWrite(tx, access, customerId);
      // Serialize changes to one contact before reading or changing its primary method.
      const [locked] = await tx
        .select()
        .from(customerContact)
        .where(
          and(
            eq(customerContact.customerId, customerId),
            eq(customerContact.id, contactId)
          )
        )
        .for("update");
      if (!locked) fail(404, "联系人不存在。");
      if (locked.version !== expectedVersion) {
        failVersionConflict({
          ...locked,
          methods: await listMethods(tx, contactId),
        });
      }

      const fields = await change(tx);
      const [contact] = await tx
        .update(customerContact)
        .set({
          ...fields,
          updatedAt: new Date(),
          version: sql`${customerContact.version} + 1`,
        })
        .where(
          and(
            eq(customerContact.id, contactId),
            eq(customerContact.customerId, customerId)
          )
        )
        .returning();
      return { ...contact, methods: await listMethods(tx, contactId) };
    });
  } catch (error) {
    if (
      isConstraintError(error, "23505", "customer_contact_method_type_unique")
    ) {
      fail(409, "同一联系人每种联系方式最多一条。");
    }
    throw error;
  }
}

function scopedMethod(contactId: string, methodId: string) {
  return and(
    eq(customerContactMethod.contactId, contactId),
    eq(customerContactMethod.id, methodId)
  );
}

async function clearPrimary(
  tx: DatabaseTransaction,
  contactId: string,
  exceptId?: string
) {
  await tx
    .update(customerContactMethod)
    .set({ isPrimary: false })
    .where(
      and(
        eq(customerContactMethod.contactId, contactId),
        eq(customerContactMethod.isPrimary, true),
        exceptId ? ne(customerContactMethod.id, exceptId) : undefined
      )
    );
}

async function promoteMethod(
  tx: DatabaseTransaction,
  contactId: string,
  methodId: string
) {
  await tx
    .update(customerContactMethod)
    .set({ isPrimary: true })
    .where(scopedMethod(contactId, methodId));
}

export const customerContactRoutes = new Hono<BusinessAccessEnv>();

customerContactRoutes.get("/:customerId/contacts", async (c) => {
  const customerId = readUuid(c.req.param("customerId"), "客户 ID");
  return c.json({
    contacts: await listContacts(c.get("businessAccess"), customerId),
  });
});

customerContactRoutes.post("/:customerId/contacts", async (c) => {
  const customerId = readUuid(c.req.param("customerId"), "客户 ID");
  const body = await readObject(c, ["name", "methods"]);
  const name = readString(body.name, "联系人姓名", 128);
  const methods = readNewContactMethods(body.methods);
  const contact = await createContact(
    c.get("businessAccess"),
    customerId,
    name,
    methods
  );
  return c.json({ contact }, 201);
});

customerContactRoutes.patch("/:customerId/contacts/:contactId", async (c) => {
  const customerId = readUuid(c.req.param("customerId"), "客户 ID");
  const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
  const body = await readObject(c, ["name", "expectedVersion"]);
  const name = readString(body.name, "联系人姓名", 128);
  const contact = await changeContact(
    c.get("businessAccess"),
    customerId,
    contactId,
    readExpectedVersion(body.expectedVersion),
    async () => ({ name })
  );
  return c.json({ contact });
});

customerContactRoutes.post(
  "/:customerId/contacts/:contactId/methods",
  async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const body = await readObject(c, versionedMethodFields);
    const method = readMethod(body);
    const contact = await changeContact(
      c.get("businessAccess"),
      customerId,
      contactId,
      readExpectedVersion(body.expectedVersion),
      async (tx) => {
        const methods = await listMethods(tx, contactId);
        const isPrimary =
          method.isPrimary === true ||
          !methods.some((method) => method.isPrimary);
        if (isPrimary) await clearPrimary(tx, contactId);
        await tx
          .insert(customerContactMethod)
          .values({ ...method, contactId, isPrimary });
      }
    );
    return c.json({ contact }, 201);
  }
);

customerContactRoutes.patch(
  "/:customerId/contacts/:contactId/methods/:methodId",
  async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const methodId = readUuid(c.req.param("methodId"), "联系方式 ID");
    const body = await readObject(c, versionedMethodFields);
    if (methodFields.every((field) => body[field] === undefined))
      fail(400, "请填写要修改的联系方式字段。");

    const type =
      body.type === undefined ? undefined : readMethodType(body.type);
    const isPrimary = readPrimary(body.isPrimary);
    const contact = await changeContact(
      c.get("businessAccess"),
      customerId,
      contactId,
      readExpectedVersion(body.expectedVersion),
      async (tx) => {
        const methods = await listMethods(tx, contactId);
        const current = methods.find((method) => method.id === methodId);
        if (!current) fail(404, "联系方式不存在。");
        const value =
          type !== undefined || body.value !== undefined
            ? readMethodValue(
                type ?? current.type,
                body.value === undefined ? current.value : body.value
              )
            : undefined;

        const replacement =
          isPrimary === false && current.isPrimary
            ? methods.find((method) => method.id !== methodId)
            : undefined;
        if (isPrimary === false && current.isPrimary && !replacement) {
          fail(400, "唯一的联系方式必须保留为主要联系方式。");
        }
        if (isPrimary === true) await clearPrimary(tx, contactId, methodId);

        await tx
          .update(customerContactMethod)
          .set({ type, value, isPrimary })
          .where(scopedMethod(contactId, methodId));
        if (replacement) await promoteMethod(tx, contactId, replacement.id);
      }
    );
    return c.json({ contact });
  }
);

customerContactRoutes.delete(
  "/:customerId/contacts/:contactId/methods/:methodId",
  async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const methodId = readUuid(c.req.param("methodId"), "联系方式 ID");
    const version = c.req.query("expectedVersion");
    const expectedVersion = readExpectedVersion(
      version && /^\d+$/.test(version) ? Number(version) : undefined
    );
    const contact = await changeContact(
      c.get("businessAccess"),
      customerId,
      contactId,
      expectedVersion,
      async (tx) => {
        const [deleted] = await tx
          .delete(customerContactMethod)
          .where(scopedMethod(contactId, methodId))
          .returning({ isPrimary: customerContactMethod.isPrimary });
        if (!deleted) fail(404, "联系方式不存在。");

        if (deleted.isPrimary) {
          const [next] = await listMethods(tx, contactId);
          if (next) await promoteMethod(tx, contactId, next.id);
        }
      }
    );
    return c.json({ contact });
  }
);
