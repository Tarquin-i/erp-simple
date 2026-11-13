import {
  companyAdministrator,
  customer,
  customerChannel,
  customerChannelAssignment,
  customerTag,
  customerTagAssignment,
  member,
  organization,
  user,
} from "@repo/db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  businessScopeWhere,
  readBusinessAccess,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "../organization/departments";
import { fail } from "../organization/errors";
import { failVersionConflict, isConstraintError } from "./input";

export interface CustomerWriteInput {
  companyName?: string;
  ownerUserId?: string;
  remark?: string | null;
  channelCodes?: string[];
  tagIds?: string[];
}

interface CustomerFilters {
  search?: string;
  channelCode?: string;
  tagId?: string;
  ownerUserId?: string;
  page: number;
  pageSize: number;
}

function selectCustomers(tx: DatabaseTransaction) {
  return tx
    .select({
      id: customer.id,
      customerNo: customer.customerNo,
      companyName: customer.companyName,
      remark: customer.remark,
      departmentId: customer.departmentId,
      ownerUserId: customer.ownerUserId,
      ownerName: user.name,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      version: customer.version,
    })
    .from(customer)
    .innerJoin(user, eq(customer.ownerUserId, user.id));
}

type CustomerRow = Awaited<ReturnType<typeof selectCustomers>>[number];

function groupByCustomer<Row extends { customerId: string }>(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.customerId);
    if (group) group.push(row);
    else groups.set(row.customerId, [row]);
  }
  return groups;
}

/**
 * 批量读取客户的渠道和标签关联，避免为每位客户单独查询。
 * @param tx 读取客户资料所用的事务。
 * @param customers 待补全的客户记录。
 * @returns 按输入顺序返回客户，缺少关联时对应字段为空数组。
 */
async function readAssignments(
  tx: DatabaseTransaction,
  customers: CustomerRow[]
) {
  if (!customers.length) return [];
  const ids = customers.map(({ id }) => id);
  const channels = await tx
    .select({
      customerId: customerChannelAssignment.customerId,
      channel: {
        code: customerChannel.code,
        name: customerChannel.name,
        color: customerChannel.color,
      },
    })
    .from(customerChannelAssignment)
    .innerJoin(
      customerChannel,
      eq(customerChannel.code, customerChannelAssignment.channelCode)
    )
    .where(inArray(customerChannelAssignment.customerId, ids))
    .orderBy(asc(customerChannel.code));
  const tags = await tx
    .select({
      customerId: customerTagAssignment.customerId,
      tag: {
        id: customerTag.id,
        name: customerTag.name,
        color: customerTag.color,
      },
    })
    .from(customerTagAssignment)
    .innerJoin(customerTag, eq(customerTag.id, customerTagAssignment.tagId))
    .where(inArray(customerTagAssignment.customerId, ids))
    .orderBy(asc(customerTag.normalizedName), asc(customerTag.id));
  const channelsByCustomer = groupByCustomer(channels);
  const tagsByCustomer = groupByCustomer(tags);

  return customers.map((row) => ({
    ...row,
    channels:
      channelsByCustomer.get(row.id)?.map(({ channel }) => channel) ?? [],
    tags: tagsByCustomer.get(row.id)?.map(({ tag }) => tag) ?? [],
  }));
}

/**
 * 在同一只读快照中读取权限、当前页、总数和关联数据。
 * @param access 调用方的业务权限，用其中的用户 ID 重新查询权限。
 * @param filters 页码、每页条数，以及可选的名称或编号搜索、渠道、标签和业务员筛选。
 * @returns 包含客户列表、总数和分页参数的结果。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403。
 */
export function listCustomers(
  access: BusinessAccess,
  filters: CustomerFilters
) {
  const { page, pageSize, search, channelCode, tagId, ownerUserId } = filters;

  return withBusinessReadSnapshot(access.userId, async (tx, currentAccess) => {
    const filter = and(
      businessScopeWhere(currentAccess, customer),
      ownerUserId ? eq(customer.ownerUserId, ownerUserId) : undefined,
      search
        ? or(
            sql`position(lower(${search}::text) in ${customer.normalizedCompanyName}) > 0`,
            sql`position(lower(${search}::text) in lower(${customer.customerNo})) > 0`
          )
        : undefined,
      channelCode
        ? exists(
            tx
              .select({ id: customerChannelAssignment.customerId })
              .from(customerChannelAssignment)
              .where(
                and(
                  eq(customerChannelAssignment.customerId, customer.id),
                  eq(customerChannelAssignment.channelCode, channelCode)
                )
              )
          )
        : undefined,
      tagId
        ? exists(
            tx
              .select({ id: customerTagAssignment.customerId })
              .from(customerTagAssignment)
              .where(
                and(
                  eq(customerTagAssignment.customerId, customer.id),
                  eq(customerTagAssignment.tagId, tagId)
                )
              )
          )
        : undefined
    );
    const rows = await selectCustomers(tx)
      .where(filter)
      .orderBy(desc(customer.createdAt), desc(customer.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ count: count() })
      .from(customer)
      .where(filter);

    return {
      customers: await readAssignments(tx, rows),
      total: total.count,
      page,
      pageSize,
    };
  });
}

/**
 * 在调用方事务内读取可见客户的完整资料，可用于返回刚写入的结果或版本冲突快照。
 * @param tx 调用方已经开启的事务。
 * @param access 调用方可查看的业务范围。
 * @param id 客户 ID。
 * @returns 客户基本资料和渠道、标签关联。
 * @throws 客户不存在或超出可见范围时抛出 HTTP 404。
 */
async function readCustomer(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string
) {
  const rows = await selectCustomers(tx).where(
    and(eq(customer.id, id), businessScopeWhere(access, customer))
  );
  const [record] = await readAssignments(tx, rows);
  if (!record) fail(404, "客户不存在。");
  return record;
}

/**
 * 在同一只读快照中读取权限、客户基本资料、渠道和标签。
 * @param access 调用方的业务权限，用其中的用户 ID 重新查询权限。
 * @param id 客户 ID。
 * @returns 客户详情。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403，客户不存在或超出可见范围时抛出 HTTP 404。
 */
export function getCustomer(access: BusinessAccess, id: string) {
  return withBusinessReadSnapshot(access.userId, (tx, currentAccess) =>
    readCustomer(tx, currentAccess, id)
  );
}

function selectAssignableOwners(
  tx: DatabaseTransaction,
  departmentId: string,
  ownerUserId?: string
) {
  return tx
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
    .where(
      and(
        eq(member.organizationId, departmentId),
        isNull(companyAdministrator.userId),
        ownerUserId === undefined ? undefined : eq(member.userId, ownerUserId)
      )
    )
    .orderBy(asc(user.name), asc(user.id));
}

/**
 * 在同一只读快照中重新读取权限，并查询可指派的业务员。
 * @param access 调用方的业务权限，用其中的用户 ID 重新查询权限。
 * @param options 管理员可传部门 ID，优先按指定部门查询。仅传客户 ID 时使用客户现有部门。两者都省略时，主管使用本部门。
 * @returns 可指派成员的 ID 和姓名，排除公司管理员。普通员工以及未指定部门或客户的公司管理员得到空数组。
 * @throws 账号不存在时抛出 HTTP 401，权限不足时抛出 HTTP 403，部门不存在或客户不可见时抛出 HTTP 404。
 */
export function listAssignableCustomerOwners(
  access: BusinessAccess,
  {
    customerId,
    departmentId,
  }: { customerId?: string; departmentId?: string } = {}
) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    if (departmentId !== undefined) {
      if (freshAccess.scope !== "company")
        fail(403, "只有公司管理员可指定部门查询业务员。");
      const [department] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, departmentId));
      if (!department) fail(404, "该部门不存在。");
      return selectAssignableOwners(tx, departmentId);
    }

    if (customerId === undefined) {
      return freshAccess.scope === "department"
        ? selectAssignableOwners(tx, freshAccess.departmentId)
        : [];
    }

    const [record] = await tx
      .select({ departmentId: customer.departmentId })
      .from(customer)
      .where(
        and(
          eq(customer.id, customerId),
          businessScopeWhere(freshAccess, customer)
        )
      );
    if (!record) fail(404, "客户不存在。");
    return freshAccess.scope === "own"
      ? []
      : selectAssignableOwners(tx, record.departmentId);
  });
}

/**
 * 验证业务员属于客户部门，并锁定其成员记录直到事务结束。
 * @param tx 当前客户写入事务。
 * @param departmentId 客户所属部门 ID。
 * @param ownerUserId 拟指派的业务员用户 ID。
 * @returns 校验通过后完成，无返回数据。
 * @throws 用户不在该部门或为公司管理员时抛出 HTTP 400。
 */
async function requireAssignableOwner(
  tx: DatabaseTransaction,
  departmentId: string,
  ownerUserId: string
) {
  const [owner] = await selectAssignableOwners(
    tx,
    departmentId,
    ownerUserId
  ).for("share", { of: member });
  if (!owner) fail(400, "请选择客户所属部门的成员作为业务员。");
}

function duplicateCustomer(): never {
  throw new HTTPException(409, {
    res: Response.json(
      { code: "duplicate_customer", message: "该部门已有同名客户。" },
      { status: 409 }
    ),
  });
}

/**
 * 写入前先共享锁定部门，再核对实时权限并锁定客户记录。
 * @param tx 调用方已经开启的写入事务。
 * @param access 调用方身份及最初的业务范围。
 * @param customerId 待修改的客户 ID。
 * @returns 重新读取的业务权限和已锁定的客户记录。
 * @throws 客户不存在或超出可见范围时抛出 HTTP 404，重新核对权限失败时抛出 HTTP 401 或 403。
 */
export async function lockCustomerForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  customerId: string
) {
  const [target] = await tx
    .select({ departmentId: customer.departmentId })
    .from(customer)
    .where(
      and(eq(customer.id, customerId), businessScopeWhere(access, customer))
    );
  if (!target) fail(404, "客户不存在。");

  await lockDepartment(tx, target.departmentId, "share");
  // 等待部门锁期间，主管可能已失去部门级访问权限。
  const freshAccess = await readBusinessAccess(tx, access.userId);
  const [record] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.departmentId, target.departmentId),
        businessScopeWhere(freshAccess, customer)
      )
    )
    .for("no key update");
  if (!record) fail(404, "客户不存在。");
  return { access: freshAccess, record };
}

async function insertAssignments(
  tx: DatabaseTransaction,
  id: string,
  input: CustomerWriteInput
) {
  if (input.channelCodes?.length) {
    await tx.insert(customerChannelAssignment).values(
      input.channelCodes.map((channelCode) => ({
        customerId: id,
        channelCode,
      }))
    );
  }
  if (input.tagIds?.length) {
    await tx
      .insert(customerTagAssignment)
      .values(input.tagIds.map((tagId) => ({ customerId: id, tagId })));
  }
}

/**
 * 将已知的客户写入约束错误转换为业务响应。
 * @param error 数据库写入抛出的错误。
 * @returns 无正常返回值。
 * @throws 同部门重名时抛出 HTTP 409，渠道或标签不存在时抛出 HTTP 400，其余错误原样抛出。
 */
function translateWriteError(error: unknown): never {
  if (isConstraintError(error, "23505", "customer_department_name_unique")) {
    duplicateCustomer();
  }
  if (
    isConstraintError(
      error,
      "23503",
      "customer_channel_assignment_channel_code_fk"
    )
  )
    fail(400, "所选渠道不存在。");
  if (
    isConstraintError(
      error,
      "23503",
      "customer_tag_assignment_tag_id_customer_tag_id_fk"
    )
  )
    fail(400, "所选标签不存在。");
  throw error;
}

/**
 * 在同一事务中创建客户及其渠道和标签，编号撞号时最多尝试五次。
 * @param access 调用方的业务权限。仅公司管理员可指定部门。
 * @param input 客户名称及可选资料。公司管理员须提交部门和业务员。
 * @returns 新建的完整客户资料，包含系统生成的编号及关联数据。
 * @throws 部门或业务员缺失、指派或关联无效时抛出 HTTP 400，权限检查失败时抛出 HTTP 401 或 403。
 * 部门不存在时抛出 HTTP 404，同部门重名或编号重试用尽时抛出 HTTP 409。
 */
export async function createCustomer(
  access: BusinessAccess,
  input: CustomerWriteInput & { companyName: string; departmentId?: string }
) {
  if (input.departmentId !== undefined && access.scope !== "company")
    fail(403, "只有公司管理员可指定客户所属部门。");
  const departmentId =
    access.scope === "company" ? input.departmentId : access.departmentId;
  if (departmentId === undefined) fail(400, "请选择客户所属部门。");
  if (access.scope === "company" && input.ownerUserId === undefined)
    fail(400, "请选择业务员。");

  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(async (tx) => {
        await lockDepartment(tx, departmentId, "share");
        const freshAccess = await readBusinessAccess(tx, access.userId);
        if (input.departmentId !== undefined) {
          if (freshAccess.scope !== "company")
            fail(403, "只有公司管理员可指定客户所属部门。");
        } else if (
          freshAccess.scope === "company" ||
          freshAccess.departmentId !== departmentId
        ) {
          fail(403, "只能在当前所属部门新建客户。");
        }
        if (input.ownerUserId !== undefined && freshAccess.scope === "own") {
          fail(403, "只有部门主管或公司管理员可在新建时指定业务员。");
        }
        const ownerUserId = input.ownerUserId ?? freshAccess.userId;
        await requireAssignableOwner(tx, departmentId, ownerUserId);

        const [record] = await tx
          .insert(customer)
          .values({
            departmentId,
            ownerUserId,
            companyName: input.companyName,
            remark: input.remark,
          })
          .returning({ id: customer.id });
        await insertAssignments(tx, record.id, input);
        return readCustomer(tx, freshAccess, record.id);
      });
    } catch (error) {
      if (!isConstraintError(error, "23505", "customer_customer_no_unique"))
        translateWriteError(error);
      if (attempt === 5) fail(409, "客户编号生成冲突，请重试。");
    }
  }
}

/**
 * 核对版本后更新客户和关联数据，在同一事务中递增版本号。
 * @param access 调用方的业务权限。仅主管或公司管理员可在客户原部门内更换业务员。
 * @param id 客户 ID。
 * @param input 需要更新的字段。省略的字段保留，空数组清空对应的渠道或标签，`null` 清空备注。
 * @param expectedVersion 调用方读取客户资料时的版本号。
 * @returns 更新后的完整客户资料和新版本号。
 * @throws 指派或关联无效时抛出 HTTP 400，权限检查失败时抛出 HTTP 401 或 403。
 * 客户不可见时抛出 HTTP 404，同部门重名或版本不一致时抛出 HTTP 409，版本冲突会附最新客户资料。
 */
export async function updateCustomer(
  access: BusinessAccess,
  id: string,
  input: CustomerWriteInput,
  expectedVersion: number
) {
  try {
    return await database.db.transaction(async (tx) => {
      const { access: freshAccess, record } = await lockCustomerForWrite(
        tx,
        access,
        id
      );
      if (input.ownerUserId !== undefined && freshAccess.scope === "own") {
        fail(403, "只有部门主管或公司管理员可更换业务员。");
      }
      // 持有客户行锁时比较版本，避免检查通过后被另一笔写入抢先修改。
      if (record.version !== expectedVersion) {
        failVersionConflict(await readCustomer(tx, freshAccess, id));
      }
      if (input.ownerUserId !== undefined) {
        await requireAssignableOwner(
          tx,
          record.departmentId,
          input.ownerUserId
        );
      }

      await tx
        .update(customer)
        .set({
          companyName: input.companyName,
          ownerUserId: input.ownerUserId,
          remark: input.remark,
          updatedAt: new Date(),
          version: sql`${customer.version} + 1`,
        })
        .where(
          and(eq(customer.id, id), businessScopeWhere(freshAccess, customer))
        );
      if (input.channelCodes !== undefined) {
        await tx
          .delete(customerChannelAssignment)
          .where(eq(customerChannelAssignment.customerId, id));
      }
      if (input.tagIds !== undefined) {
        await tx
          .delete(customerTagAssignment)
          .where(eq(customerTagAssignment.customerId, id));
      }
      await insertAssignments(tx, id, input);
      return readCustomer(tx, freshAccess, id);
    });
  } catch (error) {
    translateWriteError(error);
  }
}
