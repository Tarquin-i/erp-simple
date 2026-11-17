import {
  communication,
  communicationTag,
  communicationTagAssignment,
  customer,
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
  or,
  sql,
} from "drizzle-orm";

import {
  assertBusinessWriteTarget,
  businessScopeWhere,
  readBusinessAccess,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import { failVersionConflict, isConstraintError } from "../customer/input";
import {
  lockCustomerForWrite,
  requireAssignableOwner,
} from "../customer/records";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "../organization/departments";
import { fail } from "../organization/errors";

type CommunicationStatus = typeof communication.$inferSelect.status;

interface CommunicationFilters {
  search?: string;
  customerId?: string;
  status?: CommunicationStatus;
  tagId?: string;
  ownerUserId?: string;
  page: number;
  pageSize: number;
}

interface CreateCommunicationInput {
  customerId: string;
  title: string;
  summary: string;
  ownerUserId?: string;
  tagIds?: string[];
}

type UpdateCommunicationInput = Partial<
  Omit<CreateCommunicationInput, "customerId">
> & {
  status?: CommunicationStatus;
};

function selectCommunications(tx: DatabaseTransaction, access: BusinessAccess) {
  return (
    tx
      .select({
        id: communication.id,
        customerId: communication.customerId,
        customer: {
          id: customer.id,
          companyName: customer.companyName,
          customerNo: customer.customerNo,
        },
        ownerUserId: communication.ownerUserId,
        ownerName: user.name,
        title: communication.title,
        summary: communication.summary,
        status: communication.status,
        version: communication.version,
        createdAt: communication.createdAt,
        updatedAt: communication.updatedAt,
      })
      .from(communication)
      .innerJoin(user, eq(user.id, communication.ownerUserId))
      // 沟通归属和客户归属可能不同。客户权限不足时，不从数据库取出名称和编号。
      .leftJoin(
        customer,
        and(
          eq(customer.id, communication.customerId),
          businessScopeWhere(access, customer)
        )
      )
  );
}

type CommunicationRow = Awaited<
  ReturnType<typeof selectCommunications>
>[number];
type CommunicationTag = Pick<
  typeof communicationTag.$inferSelect,
  "id" | "name" | "color"
>;

async function readTags(tx: DatabaseTransaction, records: CommunicationRow[]) {
  if (!records.length) return [];
  const rows = await tx
    .select({
      communicationId: communicationTagAssignment.communicationId,
      tag: {
        id: communicationTag.id,
        name: communicationTag.name,
        color: communicationTag.color,
      },
    })
    .from(communicationTagAssignment)
    .innerJoin(
      communicationTag,
      eq(communicationTag.id, communicationTagAssignment.tagId)
    )
    .where(
      inArray(
        communicationTagAssignment.communicationId,
        records.map(({ id }) => id)
      )
    )
    .orderBy(asc(communicationTag.normalizedName), asc(communicationTag.id));

  const tagsByCommunication = new Map<string, CommunicationTag[]>();
  for (const { communicationId, tag } of rows) {
    const tags = tagsByCommunication.get(communicationId);
    if (tags) tags.push(tag);
    else tagsByCommunication.set(communicationId, [tag]);
  }
  return records.map((record) => ({
    ...record,
    canViewCustomer: record.customer !== null,
    tags: tagsByCommunication.get(record.id) ?? [],
  }));
}

/**
 * 查询有权查看的沟通及其标签，在同一只读快照中计算列表和总数。
 * @param access 当前业务账号，用其用户 ID 重新核对权限。
 * @param filters 搜索、筛选和分页参数。客户名称及编号仅在有客户查看权限时参与匹配。
 * @returns 当前页沟通、总数、页码和每页条数，受限的客户资料为 `null`。
 * @throws 指定客户不存在或不可查看时抛出 HTTP 404，业务权限已失效时抛出 HTTP 401 或 403。
 */
export function listCommunications(
  access: BusinessAccess,
  filters: CommunicationFilters
) {
  const { page, pageSize, search, customerId, status, tagId, ownerUserId } =
    filters;
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    if (customerId !== undefined) {
      const [visibleCustomer] = await tx
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            eq(customer.id, customerId),
            businessScopeWhere(freshAccess, customer)
          )
        );
      if (!visibleCustomer) fail(404, "客户不存在。");
    }

    const filter = and(
      businessScopeWhere(freshAccess, communication),
      customerId === undefined
        ? undefined
        : eq(communication.customerId, customerId),
      status === undefined ? undefined : eq(communication.status, status),
      ownerUserId === undefined
        ? undefined
        : eq(communication.ownerUserId, ownerUserId),
      tagId === undefined
        ? undefined
        : exists(
            tx
              .select({ id: communicationTagAssignment.tagId })
              .from(communicationTagAssignment)
              .where(
                and(
                  eq(
                    communicationTagAssignment.communicationId,
                    communication.id
                  ),
                  eq(communicationTagAssignment.tagId, tagId)
                )
              )
          ),
      search === undefined
        ? undefined
        : or(
            sql`position(lower(${search}::text) in lower(${communication.title})) > 0`,
            exists(
              tx
                .select({ id: customer.id })
                .from(customer)
                .where(
                  and(
                    eq(customer.id, communication.customerId),
                    businessScopeWhere(freshAccess, customer),
                    or(
                      sql`position(lower(${search}::text) in ${customer.normalizedCompanyName}) > 0`,
                      sql`position(lower(${search}::text) in lower(${customer.customerNo})) > 0`
                    )
                  )
                )
            )
          )
    );
    const rows = await selectCommunications(tx, freshAccess)
      .where(filter)
      .orderBy(desc(communication.updatedAt), desc(communication.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ count: count() })
      .from(communication)
      .where(filter);
    return {
      communications: await readTags(tx, rows),
      total: total.count,
      page,
      pageSize,
    };
  });
}

async function readCommunication(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string
) {
  const rows = await selectCommunications(tx, access).where(
    and(eq(communication.id, id), businessScopeWhere(access, communication))
  );
  const [record] = await readTags(tx, rows);
  if (!record) fail(404, "沟通记录不存在。");
  return record;
}

/**
 * 按沟通业务员和部门范围读取一条沟通，对关联客户单独校验权限。
 * @param access 当前业务账号，用其用户 ID 重新核对权限。
 * @param id 沟通记录 ID。
 * @returns 记录详情、标签和可查看的客户资料。
 * @throws 记录不存在或超出可见范围时抛出 HTTP 404。
 */
export function getCommunication(access: BusinessAccess, id: string) {
  return withBusinessReadSnapshot(access.userId, (tx, freshAccess) =>
    readCommunication(tx, freshAccess, id)
  );
}

/**
 * 列出可查看沟通中已经出现的业务员，供列表筛选。
 * @param access 当前业务账号，用其用户 ID 重新核对权限。
 * @returns 当前可见范围内去重后的业务员 ID 和姓名。
 */
export function listCommunicationOwners(access: BusinessAccess) {
  return withBusinessReadSnapshot(access.userId, (tx, freshAccess) =>
    tx
      .selectDistinct({ id: user.id, name: user.name })
      .from(communication)
      .innerJoin(user, eq(user.id, communication.ownerUserId))
      .where(businessScopeWhere(freshAccess, communication))
      .orderBy(asc(user.name), asc(user.id))
  );
}

async function insertTags(
  tx: DatabaseTransaction,
  id: string,
  tagIds: string[]
) {
  if (tagIds.length) {
    await tx
      .insert(communicationTagAssignment)
      .values(tagIds.map((tagId) => ({ communicationId: id, tagId })));
  }
}

/**
 * 运行完整写入事务，遇到数据库死锁时最多尝试三次。
 * @param write 包含权限、版本核对和数据写入的事务回调。
 * @returns 成功提交的事务结果。
 * @throws 标签不存在时抛出 HTTP 400，死锁重试用尽时抛出 HTTP 409，其余错误原样抛出。
 */
async function writeCommunication<T>(
  write: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(write);
    } catch (error) {
      if (
        isConstraintError(
          error,
          "23503",
          "communication_tag_assignment_tag_id_communication_tag_id_fk"
        )
      ) {
        fail(400, "所选沟通标签不存在。");
      }
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "40P01"
      ) {
        throw error;
      }
      if (attempt === 3) fail(409, "沟通记录有并发更新，请重试。");
    }
  }
}

/**
 * 在可查看的客户下创建沟通及其标签，锁定当前客户并按该客户部门校验指派。
 * @param access 当前业务账号。普通业务员只能创建由本人负责的沟通，公司管理员必须手选业务员。
 * @param input 客户、主题、内容、可选业务员和标签 ID。
 * @returns 新建记录，默认待跟进、版本为 1。
 * @throws 客户不可见时抛出 HTTP 404，指派越权抛出 HTTP 403，业务员或标签无效抛出 HTTP 400。
 */
export function createCommunication(
  access: BusinessAccess,
  input: CreateCommunicationInput
) {
  return writeCommunication(async (tx) => {
    const { access: freshAccess, record: linkedCustomer } =
      await lockCustomerForWrite(tx, access, input.customerId);
    if (freshAccess.scope === "company" && input.ownerUserId === undefined) {
      fail(400, "请选择业务员。");
    }
    const departmentId = linkedCustomer.departmentId;
    const ownerUserId = input.ownerUserId ?? freshAccess.userId;
    assertBusinessWriteTarget(freshAccess, { departmentId, ownerUserId });
    await requireAssignableOwner(tx, departmentId, ownerUserId);
    const [record] = await tx
      .insert(communication)
      .values({
        customerId: linkedCustomer.id,
        departmentId,
        ownerUserId,
        title: input.title,
        summary: input.summary,
      })
      .returning({ id: communication.id });
    await insertTags(tx, record.id, input.tagIds ?? []);
    return readCommunication(tx, freshAccess, record.id);
  });
}

/**
 * 锁定沟通后核对版本，在同一事务内保存字段、标签和新版本。
 * @param access 当前业务账号。主管及公司管理员可在客户原部门内改派业务员。
 * @param id 沟通记录 ID。
 * @param input 待修改字段，省略标签保留原值，空标签数组清空关联。
 * @param expectedVersion 操作者读取记录时取得的版本号。
 * @returns 更新后的记录和版本，仅返回有权查看的客户资料。
 * @throws 记录不可见、改派不允许或字段无效时返回相应 HTTP 错误，版本过期返回含最新快照的 HTTP 409。
 */
export function updateCommunication(
  access: BusinessAccess,
  id: string,
  input: UpdateCommunicationInput,
  expectedVersion: number
) {
  return writeCommunication(async (tx) => {
    const [target] = await tx
      .select({ departmentId: communication.departmentId })
      .from(communication)
      .where(
        and(eq(communication.id, id), businessScopeWhere(access, communication))
      );
    if (!target) fail(404, "沟通记录不存在。");

    await lockDepartment(tx, target.departmentId, "share");
    // 等待部门锁或记录锁期间可能发生主管降级或记录改派，按最新权限锁定记录。
    const freshAccess = await readBusinessAccess(tx, access.userId);
    const [record] = await tx
      .select({ version: communication.version })
      .from(communication)
      .where(
        and(
          eq(communication.id, id),
          eq(communication.departmentId, target.departmentId),
          businessScopeWhere(freshAccess, communication)
        )
      )
      .for("update");
    if (!record) fail(404, "沟通记录不存在。");
    if (input.ownerUserId !== undefined && freshAccess.scope === "own") {
      fail(403, "只有部门主管或公司管理员可更换沟通业务员。");
    }
    if (record.version !== expectedVersion) {
      failVersionConflict(await readCommunication(tx, freshAccess, id));
    }
    if (input.ownerUserId !== undefined) {
      await requireAssignableOwner(tx, target.departmentId, input.ownerUserId);
    }

    await tx
      .update(communication)
      .set({
        title: input.title,
        summary: input.summary,
        status: input.status,
        ownerUserId: input.ownerUserId,
        updatedAt: new Date(),
        version: sql`${communication.version} + 1`,
      })
      .where(eq(communication.id, id));
    if (input.tagIds !== undefined) {
      await tx
        .delete(communicationTagAssignment)
        .where(eq(communicationTagAssignment.communicationId, id));
      await insertTags(tx, id, input.tagIds);
    }
    return readCommunication(tx, freshAccess, id);
  });
}
