import { createHash } from "node:crypto";
import {
  customer,
  customerContact,
  customerContactMethod,
  customerContactMethodType,
} from "@repo/db/schema";
import {
  INVALID_MOBILE_PHONE_MESSAGE,
  normalizeMobilePhone,
} from "@repo/phone";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  businessScopeWhere,
  withBusinessReadSnapshot,
} from "../business/access";
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

const contactColumns = {
  id: customerContact.id,
  customerId: customerContact.customerId,
  name: customerContact.name,
  version: customerContact.version,
  createdAt: customerContact.createdAt,
  updatedAt: customerContact.updatedAt,
};

type Contact = Pick<
  typeof customerContact.$inferSelect,
  keyof typeof contactColumns
>;
type Method = typeof customerContactMethod.$inferSelect;
type ContactWithMethods = Contact & { methods: Method[] };
type MethodType = Method["type"];
type MethodInput = Pick<Method, "type" | "value"> & { isPrimary?: boolean };

const methodFields = ["type", "value", "isPrimary"] as const;
const versionedMethodFields = [...methodFields, "expectedVersion"] as const;
const methodEditFields = [
  ...versionedMethodFields,
  "expectedMethodVersion",
  "expectedContactVersion",
  "requireCurrentVersion",
  "restorePrimaryMethodId",
] as const;
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

function readMethod(input: Record<string, unknown>): MethodInput {
  const type = readMethodType(input.type);
  return {
    type,
    value: readMethodValue(type, input.value),
    isPrimary: readPrimary(input.isPrimary),
  };
}

/**
 * 解析新建联系人时提交的联系方式，未指定主要项时将第一项设为主要。
 * @param value 原始联系方式数组，至少包含一条记录。
 * @returns 校验后的联系方式列表，其中恰有一条主要联系方式。
 * @throws 类型重复时抛出 HTTP 409，数据格式无效或指定多个主要项时抛出 HTTP 400。
 */
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

/**
 * 在同一只读快照中校验业务权限并查询联系资料，主要联系方式排在首位。
 * @param access 调用方的业务权限，用其中的用户 ID 重新查询权限。
 * @param customerId 客户 ID。
 * @returns 带联系方式的联系人列表。客户没有联系人时返回空数组。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403，客户不存在或超出可见范围时抛出 HTTP 404。
 */
async function listContacts(access: BusinessAccess, customerId: string) {
  const rows = await withBusinessReadSnapshot(
    access.userId,
    (tx, currentAccess) =>
      tx
        .select({ contact: contactColumns, method: customerContactMethod })
        .from(customer)
        .leftJoin(customerContact, eq(customerContact.customerId, customer.id))
        .leftJoin(
          customerContactMethod,
          eq(customerContactMethod.contactId, customerContact.id)
        )
        .where(
          and(
            eq(customer.id, customerId),
            businessScopeWhere(currentAccess, customer)
          )
        )
        .orderBy(
          asc(customerContact.createdAt),
          asc(customerContact.id),
          desc(customerContactMethod.isPrimary),
          asc(customerContactMethod.createdAt),
          asc(customerContactMethod.id)
        )
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

/**
 * 读取联系人的联系方式。主要项排在最前，其余按创建时间和 ID 升序排列，供主要项递补使用。
 * @param tx 调用方已经开启的事务。
 * @param contactId 联系人 ID。
 * @returns 按上述顺序排列的联系方式，没有记录时返回空数组。
 */
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

/**
 * 按创建人和提交 ID 去重，在同一事务中创建联系人及其联系方式。
 * @param access 调用方的业务权限。
 * @param customerId 所属客户 ID。
 * @param name 已校验的联系人姓名。
 * @param methods 已校验的联系方式，包含一个主要项。
 * @param requestId 同一次新建在断线重试时复用的提交 UUID。
 * @returns 新建或已提交的联系人及其联系方式。
 * @throws 客户不可见时抛出 HTTP 404，权限检查失败时抛出 HTTP 401 或 403，同一提交 ID 用于不同内容时抛出 HTTP 409。
 */
async function createContact(
  access: BusinessAccess,
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
            customerContactMethodType.enumValues.indexOf(b.type)
        ),
      })
    )
    .digest("hex");
  return database.db.transaction(async (tx) => {
    // 同一账号的同一次提交排队，避免并发重试分别创建联系人。
    const lockKey = JSON.stringify([
      "customer-contact-create",
      access.userId,
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
          eq(customerContact.creationActorUserId, access.userId),
          eq(customerContact.creationRequestId, requestId)
        )
      );

    await lockCustomerForWrite(tx, access, existing?.customerId ?? customerId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new HTTPException(409, {
          res: Response.json(
            {
              code: "idempotency_conflict",
              message: "该提交 ID 已用于不同的联系人内容。",
            },
            { status: 409 }
          ),
        });
      }
      // 联系人可能在等待客户锁期间被修改，读取锁定后的资料。
      const [contact] = await tx
        .select(contactColumns)
        .from(customerContact)
        .where(eq(customerContact.id, existing.id));
      if (!contact) fail(404, "联系人不存在。");
      return { ...contact, methods: await listMethods(tx, contact.id) };
    }

    const [contact] = await tx
      .insert(customerContact)
      .values({
        customerId,
        name,
        creationActorUserId: access.userId,
        creationRequestId: requestId,
        creationRequestHash: requestHash,
      })
      .returning(contactColumns);
    await tx
      .insert(customerContactMethod)
      .values(methods.map((method) => ({ ...method, contactId: contact.id })));
    return { ...contact, methods: await listMethods(tx, contact.id) };
  });
}

/**
 * 按部门、客户、联系人的顺序加锁，按需校验联系人版本并在写入后递增。
 * @param access 调用方的业务权限。
 * @param customerId 所属客户 ID。
 * @param contactId 待修改的联系人 ID。
 * @param expectedContactVersion 调用方读取到的联系人版本号。普通联系方式编辑由变更操作校验单条版本。
 * @param change 事务内执行的更新操作，可修改联系方式或返回待写入的姓名。修改已生效时返回当前联系方式。
 * @returns 联系人、联系方式及版本号。修改已生效时返回锁定后的快照。
 * @throws 客户不可见或联系人不存在时抛出 HTTP 404，权限检查失败时抛出 HTTP 401 或 403。
 * 版本过期或联系方式类型重复时抛出 HTTP 409，版本冲突会附最新联系人及其联系方式。
 * 更新操作自身的校验异常也会向调用方抛出。
 */
async function changeContact(
  access: BusinessAccess,
  customerId: string,
  contactId: string,
  expectedContactVersion: number | undefined,
  change: (
    tx: DatabaseTransaction,
    lockedContact: Contact
  ) => Promise<void | { name: string } | { methods: Method[] }>
) {
  try {
    return await database.db.transaction(async (tx) => {
      await lockCustomerForWrite(tx, access, customerId);
      // 读取或变更主要联系方式前，先让同一联系人的并发更新排队。
      const [locked] = await tx
        .select(contactColumns)
        .from(customerContact)
        .where(
          and(
            eq(customerContact.customerId, customerId),
            eq(customerContact.id, contactId)
          )
        )
        .for("update");
      if (!locked) fail(404, "联系人不存在。");
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
        .returning(contactColumns);
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

/**
 * 取消当前主要联系方式，准备在同一事务中设置新的主要项。
 * @param tx 已锁定联系人的事务。
 * @param contactId 联系人 ID。
 * @param exceptId 要保留原标记的联系方式 ID。
 * @returns 更新完成后结束，无返回数据。
 */
async function clearPrimary(
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
async function promoteMethod(
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

export const customerContactRoutes = new Hono<BusinessAccessEnv>();

customerContactRoutes.get("/:customerId/contacts", async (c) => {
  const customerId = readUuid(c.req.param("customerId"), "客户 ID");
  return c.json({
    contacts: await listContacts(c.get("businessAccess"), customerId),
  });
});

customerContactRoutes.post("/:customerId/contacts", async (c) => {
  const access = c.get("businessAccess");
  const expectedAccountId = c.req.header("X-Expected-Account-Id");
  if (expectedAccountId !== undefined && expectedAccountId !== access.userId) {
    fail(401, "当前登录账号已变更，请刷新页面后重试。");
  }
  const customerId = readUuid(c.req.param("customerId"), "客户 ID");
  const body = await readObject(c, ["name", "methods"]);
  const name = readString(body.name, "联系人姓名", 128);
  const methods = readNewContactMethods(body.methods);
  const contact = await createContact(
    access,
    customerId,
    name,
    methods,
    readUuid(c.req.header("Idempotency-Key"), "提交 ID")
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
    const body = await readObject(c, methodEditFields);
    if (methodFields.every((field) => body[field] === undefined))
      fail(400, "请填写要修改的联系方式字段。");

    const type =
      body.type === undefined ? undefined : readMethodType(body.type);
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
      restorePrimaryMethodId !== undefined ||
      body.requireCurrentVersion === true;
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
    const contact = await changeContact(
      c.get("businessAccess"),
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
          body.value !== undefined &&
          (type === undefined || type === current.type) &&
          (isPrimary === undefined || isPrimary === current.isPrimary)
        ) {
          // 同一号码已保存，直接返回快照。其他过期请求仍先返回版本冲突。
          try {
            value = readMethodValue(current.type, body.value);
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
          throw new HTTPException(404, {
            res: Response.json(
              {
                code: "contact_method_not_found",
                message: "联系方式不存在。",
                current: { ...lockedContact, methods },
              },
              { status: 404 }
            ),
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
          methods.some(
            (method) => method.id !== methodId && method.type === type
          )
        ) {
          if (restorePrimaryMethodId)
            fail(409, "旧联系方式类型已被其他记录占用，无法写回。");
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
          (type !== undefined || body.value !== undefined)
        ) {
          if (
            restoredPrimary &&
            type === current.type &&
            body.value === current.value
          ) {
            // 原值还在时可直接保留，兼容只恢复主要项的旧号码。
            value = current.value;
          } else {
            value = readMethodValue(
              type ?? current.type,
              body.value === undefined ? current.value : body.value
            );
            // 还原已存在的大陆本地号码写法，普通编辑仍保存为 E.164。
            if (
              restoredPrimary &&
              typeof body.value === "string" &&
              value === `+86${body.value}`
            ) {
              value = body.value;
            }
          }
        }

        const primary = restoredPrimary
          ? restoredPrimary.id === methodId
          : isPrimary;
        // 写回选择原来的主要项。普通取消主要项时仍按创建时间和 ID 递补。
        const replacement = restoredPrimary
          ? restoredPrimary.id !== methodId && !restoredPrimary.isPrimary
            ? restoredPrimary
            : undefined
          : primary === false && current.isPrimary
            ? methods.find((method) => method.id !== methodId)
            : undefined;
        if (primary === false && current.isPrimary && !replacement) {
          fail(400, "唯一的联系方式必须保留为主要联系方式。");
        }
        if (primary === true || (restoredPrimary && replacement)) {
          await clearPrimary(tx, contactId, methodId);
        }

        await tx
          .update(customerContactMethod)
          .set({
            type,
            value,
            isPrimary: primary,
            version: sql`${customerContactMethod.version} + 1`,
          })
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

        // 删除主要项后，从剩余记录中递补。最后一条可直接删除。
        if (deleted.isPrimary) {
          const [next] = await listMethods(tx, contactId);
          if (next) await promoteMethod(tx, contactId, next.id);
        }
      }
    );
    return c.json({ contact });
  }
);
