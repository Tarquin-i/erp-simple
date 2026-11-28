import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { fail } from "../../../errors";
import { readUuid } from "../../../http/request-input";
import type { RecordAccessEnv } from "../../identity";
import type { createContactUseCases } from "../application/contacts";

import {
  readContactCreateRequest,
  readContactMethodCreateRequest,
  readContactMethodUpdateRequest,
  readContactQueryVersion,
  readContactUpdateRequest,
} from "./contact-write-requests";

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
    const { name, methods, requestId } = await readContactCreateRequest(c);
    const contact = await contacts.createContact(
      access,
      customerId,
      name,
      methods,
      requestId
    );
    return c.json({ contact }, 201);
  });

  routes.patch(
    "/:customerId/contacts/:contactId",
    contactBodyLimit,
    async (c) => {
      const customerId = readUuid(c.req.param("customerId"), "客户 ID");
      const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
      const { expectedVersion, update } = await readContactUpdateRequest(c);
      const contact = await contacts.updateContact(
        c.get("recordAccess"),
        customerId,
        contactId,
        expectedVersion,
        update
      );
      return c.json({ contact });
    }
  );

  routes.delete("/:customerId/contacts/:contactId", async (c) => {
    const customerId = readUuid(c.req.param("customerId"), "客户 ID");
    const contactId = readUuid(c.req.param("contactId"), "联系人 ID");
    const expectedVersion = readContactQueryVersion(
      c.req.query("expectedVersion")
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
    const { expectedVersion, method } = await readContactMethodCreateRequest(c);
    const contact = await contacts.addMethod(
      c.get("recordAccess"),
      customerId,
      contactId,
      expectedVersion,
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
      const update = await readContactMethodUpdateRequest(c);
      const contact = await contacts.updateMethod(
        c.get("recordAccess"),
        customerId,
        contactId,
        methodId,
        update
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
      const expectedVersion = readContactQueryVersion(
        c.req.query("expectedVersion")
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
