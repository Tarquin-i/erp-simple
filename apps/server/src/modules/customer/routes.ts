import { Hono } from "hono";

import { requireBusinessAccess } from "../business/access";
import type { BusinessAccessEnv } from "../business/access";
import { fail } from "../organization/errors";
import { customerContactRoutes } from "./contacts";
import {
  createCustomer,
  getCustomer,
  listAssignableCustomerOwners,
  listCustomers,
  updateCustomer,
} from "./customers";
import type { CustomerWriteInput } from "./customers";
import { customerDictionaryRoutes } from "./dictionaries";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "./input";

const editableFields = [
  "companyName",
  "ownerUserId",
  "remark",
  "channelCodes",
  "tagIds",
] as const;

function readRemark(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string" && !value.trim()) return null;
  return readString(value, "客户备注", 4096);
}

function readSelection(
  value: unknown,
  label: string,
  parse: (item: unknown) => string
) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    fail(400, `${label}须为最多 100 项的数组。`);
  }
  return [...new Set(value.map(parse))];
}

function readCustomerWrite(body: Record<string, unknown>): CustomerWriteInput {
  return {
    companyName:
      body.companyName === undefined
        ? undefined
        : readString(body.companyName, "客户名称", 256),
    ownerUserId:
      body.ownerUserId === undefined
        ? undefined
        : readString(body.ownerUserId, "业务员 ID", 128),
    remark: readRemark(body.remark),
    channelCodes: readSelection(body.channelCodes, "渠道", (value) =>
      readString(value, "渠道编码", 64)
    ),
    tagIds: readSelection(body.tagIds, "标签", (value) =>
      readUuid(value, "标签 ID")
    ),
  };
}

export const customerRoutes = new Hono<BusinessAccessEnv>();

customerRoutes.use("*", requireBusinessAccess);
customerRoutes.route("/", customerDictionaryRoutes);
customerRoutes.route("/", customerContactRoutes);

customerRoutes.get("/", async (c) => {
  const { search, channelCode, tagId, ownerUserId, page, pageSize } =
    c.req.query();
  const result = await listCustomers(c.get("businessAccess"), {
    search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
    channelCode:
      channelCode === undefined
        ? undefined
        : readString(channelCode, "渠道编码", 64),
    tagId: tagId === undefined ? undefined : readUuid(tagId, "标签 ID"),
    ownerUserId:
      ownerUserId === undefined
        ? undefined
        : readString(ownerUserId, "业务员 ID", 128),
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
  });
  return c.json(result);
});

customerRoutes.post("/", async (c) => {
  const access = c.get("businessAccess");
  if (access.scope === "company")
    fail(403, "请由有部门归属的业务员或主管新建客户。");
  const input = readCustomerWrite(await readObject(c, editableFields));
  if (input.companyName === undefined) fail(400, "请填写客户名称。");
  const customer = await createCustomer(access, {
    ...input,
    companyName: input.companyName,
  });
  return c.json({ customer }, 201);
});

customerRoutes.get("/assignable-owners", async (c) => {
  const owners = await listAssignableCustomerOwners(c.get("businessAccess"));
  return c.json({ owners });
});

customerRoutes.get("/:customerId/assignable-owners", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const owners = await listAssignableCustomerOwners(
    c.get("businessAccess"),
    id
  );
  return c.json({ owners });
});

customerRoutes.get("/:customerId", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const customer = await getCustomer(c.get("businessAccess"), id);
  return c.json({ customer });
});

customerRoutes.patch("/:customerId", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const body = await readObject(c, [...editableFields, "expectedVersion"]);
  if (editableFields.every((field) => body[field] === undefined)) {
    fail(400, "请提交需要更新的客户资料。");
  }
  const input = readCustomerWrite(body);
  const customer = await updateCustomer(
    c.get("businessAccess"),
    id,
    input,
    readExpectedVersion(body.expectedVersion)
  );
  return c.json({ customer });
});
