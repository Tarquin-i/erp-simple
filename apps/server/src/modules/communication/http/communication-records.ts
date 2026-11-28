import { communicationStatus } from "@repo/db/schema";
import { Hono } from "hono";
import { getBunServer } from "hono/bun";

import type { RecordAccessEnv } from "../../identity";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import { fail } from "../../../errors";
import type { CommunicationModule } from "../module";

const createFields = [
  "customerId",
  "title",
  "summary",
  "ownerUserId",
  "tagIds",
  "status",
];
const editableFields = ["title", "summary", "ownerUserId", "status", "tagIds"];

/**
 * 校验单个沟通状态。
 * @param value 请求中的状态值。
 * @returns 沟通状态。
 * @throws 状态不在数据库枚举中时抛出 HTTP 400。
 */
function readStatus(value: unknown) {
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
 * @returns 校验后的沟通内容、业务员、标签和状态字段。
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
    status: body.status === undefined ? undefined : readStatus(body.status),
  };
}

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
function readListOptionFilter<T extends string>(
  values: string[] | undefined,
  operators: string[] | undefined,
  label: string,
  parse: (item: string) => T
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

export function createCommunicationRecordRoutes({
  archiveCommunication,
  createCommunication,
  getCommunication,
  listCommunicationOwners,
  listCommunications,
  updateCommunication,
}: CommunicationModule["records"]) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/", async (c) => {
    const query = c.req.queries();
    const { search, customerId, page, pageSize } = c.req.query();
    const result = await listCommunications(c.get("recordAccess"), {
      search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
      customerId:
        customerId === undefined ? undefined : readUuid(customerId, "客户 ID"),
      statuses: readListOptionFilter(
        query.status,
        query.statusOperator,
        "状态",
        readStatus
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

  routes.get("/owners", async (c) => {
    const owners = await listCommunicationOwners(c.get("recordAccess"));
    return c.json({ owners });
  });

  routes.post("/", async (c) => {
    const access = c.get("recordAccess");
    const expectedAccountId = c.req.header("X-Expected-Account-Id");
    if (
      expectedAccountId !== undefined &&
      expectedAccountId !== access.userId
    ) {
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

  routes.get("/:communicationId", async (c) => {
    const id = readUuid(c.req.param("communicationId"), "沟通 ID");
    const communication = await getCommunication(c.get("recordAccess"), id);
    return c.json({ communication });
  });

  routes.patch("/:communicationId", async (c) => {
    const id = readUuid(c.req.param("communicationId"), "沟通 ID");
    const body = await readObject(c, [...editableFields, "expectedVersion"]);
    if (editableFields.every((field) => body[field] === undefined)) {
      fail(400, "请提交需要更新的沟通资料。");
    }

    const communication = await updateCommunication(
      c.get("recordAccess"),
      id,
      readCommunicationWrite(body),
      readExpectedVersion(body.expectedVersion)
    );
    return c.json({ communication });
  });

  routes.delete("/:communicationId", async (c) => {
    const id = readUuid(c.req.param("communicationId"), "沟通 ID");
    const version = c.req.query("expectedVersion");
    const expectedVersion = readExpectedVersion(
      version && /^\d+$/.test(version) ? Number(version) : undefined
    );
    // 批量清理未完成上传可能超过 Bun 默认的 HTTP 空闲时间。
    if (c.env) getBunServer<Bun.Server<unknown>>(c)?.timeout?.(c.req.raw, 0);
    const communication = await archiveCommunication(
      c.get("recordAccess"),
      id,
      expectedVersion
    );
    return c.json({ communication });
  });

  return routes;
}
