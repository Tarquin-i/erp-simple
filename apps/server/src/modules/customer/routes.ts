import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { BusinessAccess, BusinessAccessEnv } from "../business/access";
import { readListOptionFilter } from "../business/list-option-filter";
import { fail } from "../organization/errors";
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  listAssignableCustomerOwners,
  listCustomers,
  updateCustomer,
} from "./records";
import type { CustomerWriteInput } from "./records";
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

const listFilterFields = new Set(["channelCode", "tagId", "ownerUserId"]);
const listFields = [
  "search",
  "page",
  "pageSize",
  ...listFilterFields,
  "channelOperator",
  "tagOperator",
  "ownerOperator",
];

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

/**
 * 校验新建或编辑客户的通用字段，规范化备注并去除重复的渠道和标签。
 * @param body 已通过字段白名单校验的 JSON 请求体。
 * @returns 客户写入字段。编辑时省略字段保留原值，空数组清空对应关联，`null` 清空备注。
 * @throws 任一字段的类型、格式或长度无效时抛出 HTTP 400。
 */
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

function listCustomerPage(
  access: BusinessAccess,
  query: Record<string, string[]>
) {
  const search = query.search?.[0];
  return listCustomers(access, {
    search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
    channels: readListOptionFilter(
      query.channelCode,
      query.channelOperator,
      "渠道",
      (value) => readString(value, "渠道编码", 64)
    ),
    tags: readListOptionFilter(
      query.tagId,
      query.tagOperator,
      "标签",
      (value) => readUuid(value, "标签 ID")
    ),
    owners: readListOptionFilter(
      query.ownerUserId,
      query.ownerOperator,
      "业务员",
      (value) => readString(value, "业务员 ID", 128)
    ),
    page: readPositiveInteger(query.page?.[0], "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(query.pageSize?.[0], "每页条数", 20, 100),
  });
}

function readListBody(body: Record<string, unknown>) {
  const query: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value === "string") {
      query[field] = [value];
    } else if (
      (field === "page" || field === "pageSize") &&
      typeof value === "number"
    ) {
      query[field] = [String(value)];
    } else if (
      listFilterFields.has(field) &&
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      query[field] = value;
    } else {
      fail(400, `客户查询参数 ${field} 的格式不正确。`);
    }
  }
  return query;
}

export const customerProfileRoutes = new Hono<BusinessAccessEnv>();

customerProfileRoutes.get("/", async (c) => {
  const result = await listCustomerPage(
    c.get("businessAccess"),
    c.req.queries()
  );
  return c.json(result);
});

// 长条件通过请求体传入，与 GET 共用筛选规则和只读查询。
customerProfileRoutes.post(
  "/search",
  bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) => c.json({ message: "客户查询条件过大。" }, 413),
  }),
  async (c) => {
    const body = await readObject(c, listFields);
    const result = await listCustomerPage(
      c.get("businessAccess"),
      readListBody(body)
    );
    return c.json(result);
  }
);

customerProfileRoutes.post("/", async (c) => {
  const access = c.get("businessAccess");
  const body = await readObject(c, [...editableFields, "departmentId"]);
  if (body.departmentId !== undefined && access.scope !== "company")
    fail(403, "只有公司管理员可指定客户所属部门。");
  const input = readCustomerWrite(body);
  if (input.companyName === undefined) fail(400, "请填写客户名称。");
  const requestId = c.req.header("Idempotency-Key");
  const customer = await createCustomer(
    access,
    {
      ...input,
      companyName: input.companyName,
      departmentId:
        body.departmentId === undefined
          ? undefined
          : readString(body.departmentId, "部门 ID", 128),
    },
    requestId === undefined ? undefined : readUuid(requestId, "提交 ID")
  );
  return c.json({ customer }, 201);
});

customerProfileRoutes.get("/assignable-owners", async (c) => {
  const access = c.get("businessAccess");
  const requestedDepartment = c.req.query("departmentId");
  if (requestedDepartment !== undefined && access.scope !== "company")
    fail(403, "只有公司管理员可指定部门查询业务员。");
  const owners = await listAssignableCustomerOwners(access, {
    departmentId:
      requestedDepartment === undefined
        ? undefined
        : readString(requestedDepartment, "部门 ID", 128),
  });
  return c.json({ owners });
});

customerProfileRoutes.get("/:customerId/assignable-owners", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const owners = await listAssignableCustomerOwners(c.get("businessAccess"), {
    customerId: id,
  });
  return c.json({ owners });
});

customerProfileRoutes.get("/:customerId", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const customer = await getCustomer(c.get("businessAccess"), id);
  return c.json({ customer });
});

customerProfileRoutes.patch("/:customerId", async (c) => {
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

customerProfileRoutes.delete("/:customerId", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const version = c.req.query("expectedVersion");
  const customer = await archiveCustomer(
    c.get("businessAccess"),
    id,
    readExpectedVersion(
      version && /^\d+$/.test(version) ? Number(version) : undefined
    )
  );
  return c.json({ customer });
});
