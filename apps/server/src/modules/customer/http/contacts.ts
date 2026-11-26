import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { RecordAccessEnv } from "../../identity/http/record-access-context";
import { fail } from "../../../errors";
import {
  readContactMethods,
  readMethod,
  readMethodType,
  readPrimary,
} from "../application/contacts";
import type { createContactUseCases } from "../application/contacts";
import {
  readExpectedVersion,
  readObject,
  readString,
  readUuid,
} from "../../../http/request-input";

const methodFields = ["type", "value", "isPrimary"] as const;
const versionedMethodFields = [...methodFields, "expectedVersion"] as const;
const methodEditFields = [
  ...versionedMethodFields,
  "expectedMethodVersion",
  "expectedContactVersion",
  "requireCurrentVersion",
  "restorePrimaryMethodId",
] as const;

const contactBodyLimit = bodyLimit({
  maxSize: 128 * 1024,
  onError: (c) => c.json({ message: "联系人资料过大。" }, 413),
});

export function createCustomerContactRoutes(
  contacts: ReturnType<typeof createContactUseCases>
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/:customerId/contacts", async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    return c.json({
      contacts: await contacts.listContacts(c.get("recordAccess"), customerId),
    });
  });

  routes.post("/:customerId/contacts", contactBodyLimit, async (c) => {
    const access = c.get("recordAccess");
    const expectedAccountId = c.req.header("X-Expected-Account-Id");
    if (
      expectedAccountId !== undefined &&
      expectedAccountId !== access.userId
    ) {
      fail(401, "当前登录账号已变更，请刷新页面后重试。");
    }
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const body = await readObject(c, ["name", "methods"]);
    const name = readString(body.name, "联系人姓名", 128);
    const methods = readContactMethods(body.methods);
    const contact = await contacts.createContact(
      access,
      customerId,
      name,
      methods,
      readUuid(c.req.header("Idempotency-Key"), "提交 ID")
    );
    return c.json({ contact }, 201);
  });

  routes.patch(
    "/:customerId/contacts/:contactId",
    contactBodyLimit,
    async (c) => {
      const customerId = readUuid(c.req.param("customerId"), "客户 ID");
      const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
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
      const contact = await contacts.updateContact(
        c.get("recordAccess"),
        customerId,
        contactId,
        readExpectedVersion(body.expectedVersion),
        { name, methods, methodChanges }
      );
      return c.json({ contact });
    }
  );

  routes.delete("/:customerId/contacts/:contactId", async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const version = c.req.query("expectedVersion");
    const expectedVersion = readExpectedVersion(
      version && /^\d+$/.test(version) ? Number(version) : undefined
    );
    const contact = await contacts.archiveContact(
      c.get("recordAccess"),
      customerId,
      contactId,
      expectedVersion
    );
    return c.json({ contact });
  });

  routes.post("/:customerId/contacts/:contactId/methods", async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const body = await readObject(c, versionedMethodFields);
    const method = readMethod(body);
    const contact = await contacts.addMethod(
      c.get("recordAccess"),
      customerId,
      contactId,
      readExpectedVersion(body.expectedVersion),
      method
    );
    return c.json({ contact }, 201);
  });

  routes.patch(
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
      const contact = await contacts.updateMethod(
        c.get("recordAccess"),
        customerId,
        contactId,
        methodId,
        {
          type,
          value: body.value,
          isPrimary,
          restorePrimaryMethodId,
          strictVersion,
          expectedMethodVersion,
          expectedContactVersion,
        }
      );
      return c.json({ contact });
    }
  );

  routes.delete(
    "/:customerId/contacts/:contactId/methods/:methodId",
    async (c) => {
      const customerId = readUuid(c.req.param("customerId"), "客户 ID");
      const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
      const methodId = readUuid(c.req.param("methodId"), "联系方式 ID");
      const version = c.req.query("expectedVersion");
      const expectedVersion = readExpectedVersion(
        version && /^\d+$/.test(version) ? Number(version) : undefined
      );
      const contact = await contacts.deleteMethod(
        c.get("recordAccess"),
        customerId,
        contactId,
        methodId,
        expectedVersion
      );
      return c.json({ contact });
    }
  );

  return routes;
}
