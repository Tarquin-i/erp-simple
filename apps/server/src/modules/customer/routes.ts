import { Hono } from "hono";

import { customerAddressRoutes } from "../address/routes";
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
} from "./records";
import type { CustomerWriteInput } from "./records";
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

function readListOptionFilter(
  values: string[] | undefined,
  operators: string[] | undefined,
  label: string,
  parse: (item: string) => string
) {
  if (operators && operators.length > 1) {
    fail(400, `${label}筛选只接受一个运算符。`);
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, `请选择要筛选的${label}。`);
    return;
  }
  if (values.length > 100) fail(400, `${label}筛选最多接受 100 项。`);
  const distinctValues = [...new Set(values.map(parse))];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, `请选择与${label}所选项数量匹配的筛选运算符。`);
  }
  return { values: distinctValues, excluded: operator === exclude };
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

export const customerRoutes = new Hono<BusinessAccessEnv>();

customerRoutes.use("*", requireBusinessAccess);
customerRoutes.route("/", customerDictionaryRoutes);
customerRoutes.route("/", customerContactRoutes);
customerRoutes.route("/", customerAddressRoutes);

customerRoutes.get("/", async (c) => {
  const query = c.req.queries();
  const { search, page, pageSize } = c.req.query();
  const result = await listCustomers(c.get("businessAccess"), {
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
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
  });
  return c.json(result);
});

customerRoutes.post("/", async (c) => {
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

customerRoutes.get("/assignable-owners", async (c) => {
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

customerRoutes.get("/:customerId/assignable-owners", async (c) => {
  const id = readUuid(c.req.param("customerId"), "客户 ID");
  const owners = await listAssignableCustomerOwners(c.get("businessAccess"), {
    customerId: id,
  });
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
