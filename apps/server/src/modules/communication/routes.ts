import { communicationStatus } from "@repo/db/schema";
import { Hono } from "hono";

import { requireBusinessAccess } from "../business/access";
import type { BusinessAccessEnv } from "../business/access";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../customer/input";
import { fail } from "../organization/errors";
import { communicationDictionaryRoutes } from "./dictionaries";
import {
  createCommunication,
  getCommunication,
  listCommunicationOwners,
  listCommunications,
  updateCommunication,
} from "./records";

const createFields = [
  "customerId",
  "title",
  "summary",
  "ownerUserId",
  "tagIds",
];
const editableFields = ["title", "summary", "ownerUserId", "status", "tagIds"];

/**
 * 校验沟通状态，省略时沿用当前值或不应用状态筛选。
 * @param value 请求中的状态值。
 * @returns 沟通状态或 `undefined`。
 * @throws 状态不在数据库枚举中时抛出 HTTP 400。
 */
function readStatus(value: unknown) {
  if (value === undefined) return undefined;
  const status = communicationStatus.enumValues.find((item) => item === value);
  if (status === undefined) fail(400, "沟通状态不正确。");
  return status;
}

/**
 * 校验并去除重复的沟通标签 ID。
 * @param value 请求中的标签 ID 数组，允许省略。
 * @returns 规范化的标签 ID 列表。编辑时空数组清空关联，省略则保留原值。
 * @throws 标签数量、类型或格式无效时抛出 HTTP 400。
 */
function readTagIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    fail(400, "标签须为最多 100 项的数组。");
  }
  return [...new Set(value.map((id) => readUuid(id, "标签 ID")))];
}

/**
 * 校验新建和编辑共用的字段，保留省略字段的语义。
 * @param body 已按操作校验字段白名单的请求体。
 * @returns 校验后的沟通内容、业务员和标签字段。
 * @throws 字段类型、长度或格式无效时抛出 HTTP 400。
 */
function readCommunicationWrite(body: Record<string, unknown>) {
  return {
    title:
      body.title === undefined
        ? undefined
        : readString(body.title, "沟通主题", 128),
    summary:
      body.summary === undefined
        ? undefined
        : readString(body.summary, "初次沟通内容", 20_000),
    ownerUserId:
      body.ownerUserId === undefined
        ? undefined
        : readString(body.ownerUserId, "业务员 ID", 128),
    tagIds: readTagIds(body.tagIds),
  };
}

export const communicationRoutes = new Hono<BusinessAccessEnv>();

communicationRoutes.use("*", requireBusinessAccess);
communicationRoutes.route("/", communicationDictionaryRoutes);

communicationRoutes.get("/", async (c) => {
  const { search, customerId, status, tagId, ownerUserId, page, pageSize } =
    c.req.query();
  const result = await listCommunications(c.get("businessAccess"), {
    search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
    customerId:
      customerId === undefined ? undefined : readUuid(customerId, "客户 ID"),
    status: readStatus(status),
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

communicationRoutes.get("/owners", async (c) => {
  const owners = await listCommunicationOwners(c.get("businessAccess"));
  return c.json({ owners });
});

communicationRoutes.post("/", async (c) => {
  const access = c.get("businessAccess");
  const expectedAccountId = c.req.header("X-Expected-Account-Id");
  if (expectedAccountId !== undefined && expectedAccountId !== access.userId) {
    fail(401, "当前登录账号已变更，请刷新页面后重试。");
  }
  const body = await readObject(c, createFields);
  const input = readCommunicationWrite(body);
  if (input.title === undefined) fail(400, "请填写沟通主题。");
  if (input.summary === undefined) fail(400, "请填写初次沟通内容。");

  const communication = await createCommunication(
    access,
    {
      ...input,
      customerId: readUuid(body.customerId, "客户 ID"),
      title: input.title,
      summary: input.summary,
    },
    readUuid(c.req.header("Idempotency-Key"), "提交 ID")
  );
  return c.json({ communication }, 201);
});

communicationRoutes.get("/:communicationId", async (c) => {
  const id = readUuid(c.req.param("communicationId"), "沟通 ID");
  const communication = await getCommunication(c.get("businessAccess"), id);
  return c.json({ communication });
});

communicationRoutes.patch("/:communicationId", async (c) => {
  const id = readUuid(c.req.param("communicationId"), "沟通 ID");
  const body = await readObject(c, [...editableFields, "expectedVersion"]);
  if (editableFields.every((field) => body[field] === undefined)) {
    fail(400, "请提交需要更新的沟通资料。");
  }

  const communication = await updateCommunication(
    c.get("businessAccess"),
    id,
    { ...readCommunicationWrite(body), status: readStatus(body.status) },
    readExpectedVersion(body.expectedVersion)
  );
  return c.json({ communication });
});
