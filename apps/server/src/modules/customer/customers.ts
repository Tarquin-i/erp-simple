import {
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
  ne,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { businessScopeWhere } from "../business/access";
import type { BusinessAccess } from "../business/access";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { fail } from "../organization/errors";
import { isConstraintError } from "./input";

type DepartmentAccess = Exclude<BusinessAccess, { scope: "company" }>;

export interface CustomerWriteInput {
  companyName?: string;
  remark?: string | null;
  channelCodes?: string[];
  tagIds?: string[];
  forceDuplicate: boolean;
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

const readOnlySnapshot = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

export function listCustomers(
  access: BusinessAccess,
  filters: CustomerFilters
) {
  const { page, pageSize, search, channelCode, tagId, ownerUserId } = filters;

  return database.db.transaction(async (tx) => {
    const filter = and(
      businessScopeWhere(access, customer),
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
  }, readOnlySnapshot);
}

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

export function getCustomer(access: BusinessAccess, id: string) {
  return database.db.transaction(
    (tx) => readCustomer(tx, access, id),
    readOnlySnapshot
  );
}

async function lockDepartment(tx: DatabaseTransaction, departmentId: string) {
  // Serialize name checks and writes in a department without blocking its foreign keys.
  const [department] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, departmentId))
    .for("no key update");
  if (!department) fail(404, "部门不存在。");
}

function duplicateCustomer(sameOwner: boolean): never {
  const code = sameOwner
    ? "duplicate_customer_same_owner"
    : "duplicate_customer";
  const message = sameOwner
    ? "该业务员已有同名客户。"
    : "发现疑似重复客户，请确认是否继续保存。";
  throw new HTTPException(409, {
    res: Response.json({ code, message }, { status: 409 }),
  });
}

async function checkDuplicateName(
  tx: DatabaseTransaction,
  target: { departmentId: string; ownerUserId: string; id?: string },
  companyName: string,
  forceDuplicate: boolean
) {
  const name = sql`lower(btrim(${companyName}::text))`;
  const existingName = customer.normalizedCompanyName;
  const exact = eq(existingName, name);
  const sameOwner = sql<boolean>`(${exact} and ${eq(customer.ownerUserId, target.ownerUserId)})`;
  const fuzzy = and(
    sql`char_length(${name}) >= 4`,
    or(
      sql`position(${name} in ${existingName}) > 0`,
      and(
        sql`char_length(${existingName}) >= 4`,
        sql`position(${existingName} in ${name}) > 0`
      )
    )
  );
  const [duplicate] = await tx
    .select({ sameOwner })
    .from(customer)
    .where(
      and(
        eq(customer.departmentId, target.departmentId),
        target.id ? ne(customer.id, target.id) : undefined,
        or(exact, fuzzy)
      )
    )
    .orderBy(desc(sameOwner))
    .limit(1);
  if (duplicate?.sameOwner) duplicateCustomer(true);
  if (duplicate && !forceDuplicate) duplicateCustomer(false);
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

function translateWriteError(error: unknown): never {
  if (
    isConstraintError(error, "23505", "customer_department_name_owner_unique")
  )
    duplicateCustomer(true);
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

export async function createCustomer(
  access: DepartmentAccess,
  input: CustomerWriteInput & { companyName: string }
) {
  const target = {
    departmentId: access.departmentId,
    ownerUserId: access.userId,
  };

  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(async (tx) => {
        await lockDepartment(tx, target.departmentId);
        const [membership] = await tx
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.userId, target.ownerUserId),
              eq(member.organizationId, target.departmentId)
            )
          )
          .for("share");
        if (!membership) fail(403, "加入部门后才能新建客户。");
        await checkDuplicateName(
          tx,
          target,
          input.companyName,
          input.forceDuplicate
        );
        const [record] = await tx
          .insert(customer)
          .values({
            ...target,
            companyName: input.companyName,
            remark: input.remark,
          })
          .returning({ id: customer.id });
        await insertAssignments(tx, record.id, input);
        return readCustomer(tx, access, record.id);
      });
    } catch (error) {
      if (!isConstraintError(error, "23505", "customer_customer_no_unique"))
        translateWriteError(error);
      if (attempt === 5) fail(409, "客户编号生成冲突，请重试。");
    }
  }
}

export async function updateCustomer(
  access: BusinessAccess,
  id: string,
  input: CustomerWriteInput
) {
  const scope = and(eq(customer.id, id), businessScopeWhere(access, customer));

  try {
    return await database.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ departmentId: customer.departmentId })
        .from(customer)
        .where(scope);
      if (!target) fail(404, "客户不存在。");
      await lockDepartment(tx, target.departmentId);
      const [current] = await tx
        .select()
        .from(customer)
        .where(scope)
        .for("no key update");
      if (!current) fail(404, "客户不存在。");

      if (
        input.companyName !== undefined &&
        input.companyName !== current.companyName
      ) {
        await checkDuplicateName(
          tx,
          current,
          input.companyName,
          input.forceDuplicate
        );
      }

      await tx
        .update(customer)
        .set({
          companyName: input.companyName,
          remark: input.remark,
          updatedAt: new Date(),
        })
        .where(scope);
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
      return readCustomer(tx, access, id);
    });
  } catch (error) {
    translateWriteError(error);
  }
}
