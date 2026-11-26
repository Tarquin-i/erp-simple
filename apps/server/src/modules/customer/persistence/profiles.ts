import type { DatabaseTransaction } from "@repo/db";
import {
  customer,
  customerAddress,
  customerChannel,
  customerChannelAssignment,
  customerTag,
  customerTagAssignment,
  product,
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
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { recordScopeWhere } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { archiveCustomerContacts } from "./contacts";

export interface CustomerWriteInput {
  companyName?: string;
  ownerUserId?: string;
  remark?: string | null;
  channelCodes?: string[];
  tagIds?: string[];
}

type ListOptionFilter = {
  values: string[];
  excluded: boolean;
};

export interface CustomerFilters {
  search?: string;
  channels?: ListOptionFilter;
  tags?: ListOptionFilter;
  owners?: ListOptionFilter;
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
      status: customer.status,
      archivedAt: customer.archivedAt,
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

export async function selectCustomerPage(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  filters: CustomerFilters
) {
  const { page, pageSize, search, channels, tags, owners } = filters;
  const channelMatches = channels?.excluded ? notExists : exists;
  const tagMatches = tags?.excluded ? notExists : exists;
  const ownerMatches = owners?.excluded ? notInArray : inArray;

  const filter = and(
    recordScopeWhere(access, customer),
    eq(customer.status, "active"),
    owners ? ownerMatches(customer.ownerUserId, owners.values) : undefined,
    search
      ? or(
          sql`position(lower(${search}::text) in ${customer.normalizedCompanyName}) > 0`,
          sql`position(lower(${search}::text) in lower(${customer.customerNo})) > 0`
        )
      : undefined,
    channels
      ? channelMatches(
          tx
            .select({ id: customerChannelAssignment.customerId })
            .from(customerChannelAssignment)
            .where(
              and(
                eq(customerChannelAssignment.customerId, customer.id),
                inArray(customerChannelAssignment.channelCode, channels.values)
              )
            )
        )
      : undefined,
    tags
      ? tagMatches(
          tx
            .select({ id: customerTagAssignment.customerId })
            .from(customerTagAssignment)
            .where(
              and(
                eq(customerTagAssignment.customerId, customer.id),
                inArray(customerTagAssignment.tagId, tags.values)
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
}

export async function findCustomerProfile(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  includeArchived = false
) {
  const rows = await selectCustomers(tx).where(
    and(
      eq(customer.id, id),
      recordScopeWhere(access, customer),
      includeArchived ? undefined : eq(customer.status, "active")
    )
  );
  const [record] = await readAssignments(tx, rows);
  return record;
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

export async function lockCustomerCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  // 提交锁先于部门锁，保证并发重试在同一笔事务内读取结果。
  const lockKey = JSON.stringify(["customer-create", userId, requestId]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  );
  const [existing] = await tx
    .select({ id: customer.id, hash: customer.creationRequestHash })
    .from(customer)
    .where(
      and(
        eq(customer.creationActorUserId, userId),
        eq(customer.creationRequestId, requestId)
      )
    );
  return existing;
}

export async function insertCustomerProfile(
  tx: DatabaseTransaction,
  values: typeof customer.$inferInsert,
  assignments: CustomerWriteInput
) {
  const [record] = await tx.insert(customer).values(values).returning({
    id: customer.id,
  });
  await insertAssignments(tx, record.id, assignments);
  return record.id;
}

export async function hasActiveCustomerNameConflict(
  tx: DatabaseTransaction,
  departmentId: string,
  companyName: string,
  id: string
) {
  // 与生成列使用同一规范化规则，互换名称前先检查占用。
  const [duplicate] = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.departmentId, departmentId),
        eq(customer.status, "active"),
        eq(
          customer.normalizedCompanyName,
          sql`lower(btrim(${companyName}::text))`
        ),
        ne(customer.id, id)
      )
    )
    .limit(1);
  return Boolean(duplicate);
}

export async function updateCustomerProfile(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  input: CustomerWriteInput
) {
  await tx
    .update(customer)
    .set({
      companyName: input.companyName,
      ownerUserId: input.ownerUserId,
      remark: input.remark,
      updatedAt: new Date(),
      version: sql`${customer.version} + 1`,
    })
    .where(and(eq(customer.id, id), recordScopeWhere(access, customer)));
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
}

export async function hasActiveCustomerProduct(
  tx: DatabaseTransaction,
  id: string
) {
  const [activeProduct] = await tx
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.customerId, id), eq(product.status, "active")))
    .limit(1);
  return Boolean(activeProduct);
}

export async function archiveCustomerProfile(
  tx: DatabaseTransaction,
  id: string,
  userId: string,
  archivedAt: Date
) {
  await tx
    .update(customer)
    .set({
      status: "archived",
      archivedAt,
      archivedByUserId: userId,
      updatedAt: archivedAt,
      version: sql`${customer.version} + 1`,
    })
    .where(eq(customer.id, id));
  await tx
    .update(customerAddress)
    .set({
      status: "archived",
      isDefault: false,
      updatedAt: archivedAt,
      version: sql`${customerAddress.version} + 1`,
    })
    .where(
      and(
        eq(customerAddress.customerId, id),
        eq(customerAddress.status, "active")
      )
    );
  await archiveCustomerContacts(tx, id, userId, archivedAt);
}
