import {
  companyAdministrator,
  customer,
  customerChannel,
  customerChannelAssignment,
  customerTag,
  customerTagAssignment,
  member,
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

import { businessScopeWhere, readBusinessAccess } from "../business/access";
import type { BusinessAccess } from "../business/access";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "../organization/departments";
import { fail } from "../organization/errors";
import { failVersionConflict, isConstraintError } from "./input";

type DepartmentAccess = Exclude<BusinessAccess, { scope: "company" }>;

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

export function listAssignableCustomerOwners(
  access: BusinessAccess,
  customerId?: string
) {
  return database.db.transaction(async (tx) => {
    const freshAccess = await readBusinessAccess(tx, access.userId);
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
  }, readOnlySnapshot);
}

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

  await lockDepartment(tx, target.departmentId);
  // A supervisor can lose department-wide access while waiting for the lock.
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

export async function createCustomer(
  access: DepartmentAccess,
  input: CustomerWriteInput & { companyName: string }
) {
  const { departmentId } = access;

  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(async (tx) => {
        await lockDepartment(tx, departmentId);
        const freshAccess = await readBusinessAccess(tx, access.userId);
        if (
          freshAccess.scope === "company" ||
          freshAccess.departmentId !== departmentId
        ) {
          fail(403, "请由有部门归属的业务员或主管新建客户。");
        }
        if (
          input.ownerUserId !== undefined &&
          freshAccess.scope !== "department"
        ) {
          fail(403, "只有部门主管可在新建时指定业务员。");
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
