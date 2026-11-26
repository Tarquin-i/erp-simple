import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
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
  isNull,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { SelectedFieldsFlat } from "drizzle-orm/pg-core";

import {
  assertBusinessWriteTarget,
  businessScopeWhere,
  readBusinessAccess,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import type { ListOptionFilter } from "../business/list-option-filter";
import { lockCustomerForWrite, requireAssignableOwner } from "../customer";
import { failVersionConflict } from "../../errors";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "../organization/departments";
import { fail } from "../organization/errors";
import { CommunicationArchiveInProgress } from "./archive-in-progress";
import type { AttachmentStorage } from "./attachment-storage";
import {
  cleanupCommunicationAttachments,
  closeCommunicationUploads,
  readCommunicationAttachmentsToClean,
  requestAttachmentUploadCleanup,
} from "./attachments";

type CommunicationStatus = typeof communication.$inferSelect.status;

interface CommunicationFilters {
  search?: string;
  customerId?: string;
  statuses?: ListOptionFilter<CommunicationStatus>;
  tags?: ListOptionFilter;
  owners?: ListOptionFilter;
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

const listFields = {
  id: communication.id,
  title: communication.title,
  ownerName: user.name,
  status: communication.status,
  archiveStartedAt: communication.archiveStartedAt,
  archivedAt: communication.archivedAt,
  updatedAt: communication.updatedAt,
};

const customerFields = {
  id: customer.id,
  companyName: customer.companyName,
  status: customer.status,
};
const tagFields = {
  id: communicationTag.id,
  name: communicationTag.name,
  color: communicationTag.color,
};
const activeCommunication = isNull(communication.archivedAt);

function visibleCustomerJoin(access: BusinessAccess) {
  // 沟通归属和客户归属可能不同。客户权限不足时，不从数据库取出名称和编号。
  return and(
    eq(customer.id, communication.customerId),
    businessScopeWhere(access, customer)
  );
}

async function readTags<
  Row extends { id: string },
  Fields extends SelectedFieldsFlat,
>(tx: DatabaseTransaction, records: Row[], fields: Fields) {
  if (!records.length) return [];
  const rows = await tx
    .select({
      communicationId: communicationTagAssignment.communicationId,
      tag: fields,
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

  const tagsByCommunication = new Map<string, (typeof rows)[number]["tag"][]>();
  for (const { communicationId, tag } of rows) {
    const tags = tagsByCommunication.get(communicationId);
    if (tags) tags.push(tag);
    else tagsByCommunication.set(communicationId, [tag]);
  }
  return records.map((record) => ({
    ...record,
    tags: tagsByCommunication.get(record.id) ?? [],
  }));
}

/**
 * 查询有权查看的沟通及其标签，在同一只读快照中计算列表和总数。
 * @param access 当前业务账号，用其用户 ID 重新核对权限。
 * @param filters 搜索、筛选和分页参数。客户名称及编号仅在有客户查看权限时参与匹配。
 * @returns 列表展示字段、总数、页码和每页条数。主列表的受限客户为 `null`，客户页签省略客户资料。
 * @throws 指定客户不存在或不可查看时抛出 HTTP 404，业务权限已失效时抛出 HTTP 401 或 403。
 */
export function listCommunications(
  access: BusinessAccess,
  filters: CommunicationFilters
) {
  const { page, pageSize, search, customerId, statuses, tags, owners } =
    filters;
  const statusMatches = statuses?.excluded ? notInArray : inArray;
  const tagMatches = tags?.excluded ? notExists : exists;
  const ownerMatches = owners?.excluded ? notInArray : inArray;
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
      activeCommunication,
      businessScopeWhere(freshAccess, communication),
      customerId === undefined
        ? undefined
        : eq(communication.customerId, customerId),
      statuses
        ? statusMatches(communication.status, statuses.values)
        : undefined,
      owners
        ? ownerMatches(communication.ownerUserId, owners.values)
        : undefined,
      tags === undefined
        ? undefined
        : tagMatches(
            tx
              .select({ id: communicationTagAssignment.tagId })
              .from(communicationTagAssignment)
              .where(
                and(
                  eq(
                    communicationTagAssignment.communicationId,
                    communication.id
                  ),
                  inArray(communicationTagAssignment.tagId, tags.values)
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
    const query =
      customerId === undefined
        ? tx
            .select({
              ...listFields,
              customer: customerFields,
              canViewCustomer: sql<boolean>`${customer.id} is not null`,
            })
            .from(communication)
            .innerJoin(user, eq(user.id, communication.ownerUserId))
            .leftJoin(customer, visibleCustomerJoin(freshAccess))
        : tx
            .select(listFields)
            .from(communication)
            .innerJoin(user, eq(user.id, communication.ownerUserId));
    const rows = await query
      .where(filter)
      .orderBy(desc(communication.updatedAt), desc(communication.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ count: count() })
      .from(communication)
      .where(filter);
    return {
      communications: await readTags(tx, rows, tagFields),
      total: total.count,
      page,
      pageSize,
    };
  });
}

async function readCommunication(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  includeArchived = false
) {
  const rows = await tx
    .select({
      ...listFields,
      customerId: communication.customerId,
      customer: { ...customerFields, customerNo: customer.customerNo },
      ownerUserId: communication.ownerUserId,
      summary: communication.summary,
      version: communication.version,
      createdAt: communication.createdAt,
    })
    .from(communication)
    .innerJoin(user, eq(user.id, communication.ownerUserId))
    .leftJoin(customer, visibleCustomerJoin(access))
    .where(
      and(
        eq(communication.id, id),
        includeArchived ? undefined : activeCommunication,
        businessScopeWhere(access, communication)
      )
    );
  const [record] = await readTags(tx, rows, tagFields);
  if (!record) fail(404, "沟通记录不存在。");
  return { ...record, canViewCustomer: record.customer !== null };
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
      .where(
        and(activeCommunication, businessScopeWhere(freshAccess, communication))
      )
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

async function lockCommunicationForWrite(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  includeArchived = false
) {
  const [target] = await tx
    .select({ departmentId: communication.departmentId })
    .from(communication)
    .where(
      and(
        eq(communication.id, id),
        includeArchived ? undefined : activeCommunication,
        businessScopeWhere(access, communication)
      )
    );
  if (!target) fail(404, "沟通记录不存在。");

  await lockDepartment(tx, target.departmentId, "share");
  // 等待部门锁或记录锁期间可能发生主管降级或记录改派，按最新权限锁定记录。
  const freshAccess = await readBusinessAccess(tx, access.userId);
  const [record] = await tx
    .select({
      departmentId: communication.departmentId,
      version: communication.version,
      archiveStartedAt: communication.archiveStartedAt,
      archivedAt: communication.archivedAt,
    })
    .from(communication)
    .where(
      and(
        eq(communication.id, id),
        eq(communication.departmentId, target.departmentId),
        includeArchived ? undefined : activeCommunication,
        businessScopeWhere(freshAccess, communication)
      )
    )
    .for("update");
  if (!record) fail(404, "沟通记录不存在。");
  return { freshAccess, record };
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
 * 计算已校验的新建请求指纹，忽略标签顺序及空标签列表的写法差异。
 * @param input 已校验客户、主题、内容、业务员和标签。
 * @returns 十六进制 SHA-256 摘要，用于核对重试时的原始内容。
 */
function fingerprintCreation(input: CreateCommunicationInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        customerId: input.customerId,
        title: input.title,
        summary: input.summary,
        ownerUserId: input.ownerUserId ?? null,
        tagIds: input.tagIds?.toSorted() ?? [],
      })
    )
    .digest("hex");
}

/**
 * 在可查看的客户下创建沟通及其标签，锁定当前客户并按该客户部门校验指派。
 * @param access 当前业务账号。普通业务员只能创建由本人负责的沟通，公司管理员必须手选业务员。
 * @param input 客户、主题、内容、可选业务员和标签 ID。
 * @param requestId 同一次新建在断线重试时复用的提交 UUID，按创建人隔离。
 * @returns 新建记录，或以当前权限重新读取该提交已经创建的记录。
 * @throws 客户或重试记录不可见时返回 HTTP 404，指派越权返回 HTTP 403，字段无效返回 HTTP 400，同一提交内容不同返回 HTTP 409。
 */
export function createCommunication(
  access: BusinessAccess,
  input: CreateCommunicationInput,
  requestId: string
) {
  const requestHash = fingerprintCreation(input);
  return writeCommunication(async (tx) => {
    // 同一账号的同一次提交排队，其他提交可并行。事务结束时自动释放锁。
    const lockKey = JSON.stringify([
      "communication-create",
      access.userId,
      requestId,
    ]);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );
    const [existing] = await tx
      .select({
        id: communication.id,
        departmentId: communication.departmentId,
        requestHash: communication.creationRequestHash,
      })
      .from(communication)
      .where(
        and(
          eq(communication.creationActorUserId, access.userId),
          eq(communication.creationRequestId, requestId)
        )
      );

    if (existing) {
      // 使用与编辑一致的锁顺序，在持锁期间核对当前业务权限和记录归属。
      await lockDepartment(tx, existing.departmentId, "share");
      const freshAccess = await readBusinessAccess(tx, access.userId);
      const [visible] = await tx
        .select({ id: communication.id })
        .from(communication)
        .where(
          and(
            eq(communication.id, existing.id),
            businessScopeWhere(freshAccess, communication)
          )
        )
        .for("share");
      if (!visible) fail(404, "沟通记录不存在。");
      if (existing.requestHash !== requestHash) {
        throw new HTTPException(409, {
          res: Response.json(
            {
              code: "idempotency_conflict",
              message: "该提交 ID 已用于不同的沟通内容。",
            },
            { status: 409 }
          ),
        });
      }
      return readCommunication(tx, freshAccess, visible.id);
    }

    const { access: freshAccess, record: linkedCustomer } =
      await lockCustomerForWrite(tx, access, input.customerId, "share");
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
        creationActorUserId: freshAccess.userId,
        creationRequestId: requestId,
        creationRequestHash: requestHash,
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
    const { freshAccess, record } = await lockCommunicationForWrite(
      tx,
      access,
      id
    );
    if (record.archiveStartedAt) throw new CommunicationArchiveInProgress();
    if (input.ownerUserId !== undefined && freshAccess.scope === "own") {
      fail(403, "只有部门主管或公司管理员可更换沟通业务员。");
    }
    if (record.version !== expectedVersion) {
      failVersionConflict(await readCommunication(tx, freshAccess, id));
    }
    if (input.ownerUserId !== undefined) {
      await requireAssignableOwner(tx, record.departmentId, input.ownerUserId);
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

async function finishCommunicationArchive(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string
) {
  const archivedAt = new Date();
  await tx
    .update(communication)
    .set({
      archiveStartedAt: null,
      archivedAt,
      archivedByUserId: access.userId,
      version: sql`${communication.version} + 1`,
      updatedAt: archivedAt,
    })
    .where(eq(communication.id, id));
  return readCommunication(tx, access, id, true);
}

async function lockCommunicationForArchive(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  expectedVersion: number
) {
  const locked = await lockCommunicationForWrite(tx, access, id, true);
  const { freshAccess, record } = locked;
  if (record.archivedAt) {
    if (record.version !== expectedVersion + 1) fail(404, "沟通记录不存在。");
  } else if (record.version !== expectedVersion) {
    failVersionConflict(await readCommunication(tx, freshAccess, id));
  }
  return locked;
}

const archiveCleanupBatchSize = 3;

/** 关闭未完成的上传并分批清理。可用同一版本续做或确认归档结果。 */
export async function archiveCommunication(
  access: BusinessAccess,
  id: string,
  expectedVersion: number,
  getStorage: () => AttachmentStorage
) {
  const started = await writeCommunication(async (tx) => {
    const { freshAccess, record } = await lockCommunicationForArchive(
      tx,
      access,
      id,
      expectedVersion
    );
    if (record.archivedAt) {
      return {
        communication: await readCommunication(tx, freshAccess, id, true),
      };
    }
    if (!record.archiveStartedAt) {
      const startedAt = new Date();
      await tx
        .update(communication)
        .set({
          archiveStartedAt: startedAt,
          updatedAt: communication.updatedAt,
        })
        .where(eq(communication.id, id));
      await closeCommunicationUploads(tx, id, freshAccess.userId, startedAt);
    }
    const attachments = await readCommunicationAttachmentsToClean(
      tx,
      id,
      archiveCleanupBatchSize
    );
    return attachments.length
      ? { attachments }
      : {
          communication: await finishCommunicationArchive(tx, freshAccess, id),
        };
  });
  if (!started.attachments) return started.communication;

  let cleanupError: HTTPException | undefined;
  try {
    await cleanupCommunicationAttachments(started.attachments, getStorage);
  } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 503) throw error;
    // 另一个归档请求可能已经清理成功，仍按当前权限和版本核对结果。
    cleanupError = error;
  }
  const archived = await writeCommunication(async (tx) => {
    const { freshAccess, record } = await lockCommunicationForArchive(
      tx,
      access,
      id,
      expectedVersion
    );
    if (record.archivedAt) {
      return readCommunication(tx, freshAccess, id, true);
    }
    if ((await readCommunicationAttachmentsToClean(tx, id, 1)).length) return;
    return finishCommunicationArchive(tx, freshAccess, id);
  });
  if (archived) return archived;

  requestAttachmentUploadCleanup();
  if (cleanupError) throw cleanupError;
  throw new HTTPException(409, {
    res: Response.json(
      {
        code: "archive_cleanup_pending",
        message: "后台正在清理剩余附件，请稍后继续归档。",
      },
      { status: 409 }
    ),
  });
}
