import type { DatabaseTransaction } from "@repo/db";
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
import type { SelectedFieldsFlat } from "drizzle-orm/pg-core";

import {
  lockDepartment,
  readAccountRecordAccess,
  recordScopeWhere,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { fail } from "../../../errors";

type CommunicationStatus = typeof communication.$inferSelect.status;

type ListOptionFilter<T extends string = string> = {
  values: T[];
  excluded: boolean;
};

export interface CommunicationFilters {
  search?: string;
  customerId?: string;
  statuses?: ListOptionFilter<CommunicationStatus>;
  tags?: ListOptionFilter;
  owners?: ListOptionFilter;
  page: number;
  pageSize: number;
}

export interface CreateCommunicationInput {
  customerId: string;
  title: string;
  summary: string;
  ownerUserId?: string;
  tagIds?: string[];
}

export type UpdateCommunicationInput = Partial<
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

function visibleCustomerJoin(access: AccountRecordAccess) {
  // 沟通归属和客户归属可能不同。客户权限不足时，不从数据库取出名称和编号。
  return and(
    eq(customer.id, communication.customerId),
    recordScopeWhere(access, customer)
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

/** 在调用方的只读快照中读取沟通、标签与总数。 */
export async function selectCommunicationPage(
  tx: DatabaseTransaction,
  freshAccess: AccountRecordAccess,
  filters: CommunicationFilters
) {
  const { page, pageSize, search, customerId, statuses, tags, owners } =
    filters;
  const statusMatches = statuses?.excluded ? notInArray : inArray;
  const tagMatches = tags?.excluded ? notExists : exists;
  const ownerMatches = owners?.excluded ? notInArray : inArray;
  if (customerId !== undefined) {
    const [visibleCustomer] = await tx
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(
          eq(customer.id, customerId),
          recordScopeWhere(freshAccess, customer)
        )
      );
    if (!visibleCustomer) fail(404, "客户不存在。");
  }

  const filter = and(
    activeCommunication,
    recordScopeWhere(freshAccess, communication),
    customerId === undefined
      ? undefined
      : eq(communication.customerId, customerId),
    statuses ? statusMatches(communication.status, statuses.values) : undefined,
    owners ? ownerMatches(communication.ownerUserId, owners.values) : undefined,
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
                  recordScopeWhere(freshAccess, customer),
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
}

export async function readCommunication(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
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
        recordScopeWhere(access, communication)
      )
    );
  const [record] = await readTags(tx, rows, tagFields);
  if (!record) fail(404, "沟通记录不存在。");
  return { ...record, canViewCustomer: record.customer !== null };
}

export function selectCommunicationOwners(
  tx: DatabaseTransaction,
  access: AccountRecordAccess
) {
  return tx
    .selectDistinct({ id: user.id, name: user.name })
    .from(communication)
    .innerJoin(user, eq(user.id, communication.ownerUserId))
    .where(and(activeCommunication, recordScopeWhere(access, communication)))
    .orderBy(asc(user.name), asc(user.id));
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

export async function lockCommunicationForWrite(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
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
        recordScopeWhere(access, communication)
      )
    );
  if (!target) fail(404, "沟通记录不存在。");

  await lockDepartment(tx, target.departmentId, "share");
  // 等待部门锁或记录锁期间可能发生主管降级或记录改派，按最新权限锁定记录。
  const freshAccess = await readAccountRecordAccess(tx, access.userId);
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
        recordScopeWhere(freshAccess, communication)
      )
    )
    .for("update");
  if (!record) fail(404, "沟通记录不存在。");
  return { freshAccess, record };
}

export async function lockCommunicationCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  // 同一账号的同一次提交排队，其他提交可并行。事务结束时自动释放锁。
  const lockKey = JSON.stringify(["communication-create", userId, requestId]);
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
        eq(communication.creationActorUserId, userId),
        eq(communication.creationRequestId, requestId)
      )
    );
  return existing;
}

/** 重试新建时先锁部门，再按当前权限锁已创建的记录。 */
export async function lockCreatedCommunication(
  tx: DatabaseTransaction,
  userId: string,
  existing: { departmentId: string; id: string }
) {
  await lockDepartment(tx, existing.departmentId, "share");
  const freshAccess = await readAccountRecordAccess(tx, userId);
  const [visible] = await tx
    .select({ id: communication.id })
    .from(communication)
    .where(
      and(
        eq(communication.id, existing.id),
        recordScopeWhere(freshAccess, communication)
      )
    )
    .for("share");
  if (!visible) fail(404, "沟通记录不存在。");
  return { freshAccess, visible };
}

export async function insertCommunication(
  tx: DatabaseTransaction,
  input: CreateCommunicationInput,
  departmentId: string,
  ownerUserId: string,
  request: { userId: string; id: string; hash: string }
) {
  const [record] = await tx
    .insert(communication)
    .values({
      creationActorUserId: request.userId,
      creationRequestId: request.id,
      creationRequestHash: request.hash,
      customerId: input.customerId,
      departmentId,
      ownerUserId,
      title: input.title,
      summary: input.summary,
    })
    .returning({ id: communication.id });
  await insertTags(tx, record.id, input.tagIds ?? []);
  return record.id;
}

export async function updateCommunicationRecord(
  tx: DatabaseTransaction,
  id: string,
  input: UpdateCommunicationInput
) {
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
}

export async function startCommunicationArchive(
  tx: DatabaseTransaction,
  id: string,
  startedAt: Date
) {
  await tx
    .update(communication)
    .set({
      archiveStartedAt: startedAt,
      updatedAt: communication.updatedAt,
    })
    .where(eq(communication.id, id));
}

export async function markCommunicationArchived(
  tx: DatabaseTransaction,
  id: string,
  archivedByUserId: string
) {
  const archivedAt = new Date();
  await tx
    .update(communication)
    .set({
      archiveStartedAt: null,
      archivedAt,
      archivedByUserId,
      version: sql`${communication.version} + 1`,
      updatedAt: archivedAt,
    })
    .where(eq(communication.id, id));
}
