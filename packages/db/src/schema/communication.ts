import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { customer } from "./customer";
import { member, organization } from "./organization";

export const communicationStatus = pgEnum("communication_status", [
  "pending",
  "urgent",
  "completed",
]);

/** 每条沟通归属一个客户和一名业务员，业务员可以不同于客户负责人。 */
export const communication = pgTable(
  "communication",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    departmentId: text("department_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    title: varchar("title", { length: 128 }).notNull(),
    summary: text("summary").notNull(),
    status: communicationStatus("status").default("pending").notNull(),
    // 历史记录没有提交标识，新记录用于确认断线后重试的同一次新建。
    creationActorUserId: text("creation_actor_user_id"),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: varchar("creation_request_hash", { length: 64 }),
    // 后端保存时用版本号核对并发修改。
    version: integer("version").default(1).notNull(),
    archiveStartedAt: timestamp("archive_started_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: text("archived_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 共同引用部门 ID，确保客户和沟通业务员属于同一部门。
    foreignKey({
      name: "communication_customer_department_fk",
      columns: [table.customerId, table.departmentId],
      foreignColumns: [customer.id, customer.departmentId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "communication_department_owner_member_fk",
      columns: [table.departmentId, table.ownerUserId],
      foreignColumns: [member.organizationId, member.userId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("communication_updated_at_idx").on(table.updatedAt, table.id),
    index("communication_customer_updated_at_idx").on(
      table.customerId,
      table.updatedAt,
      table.id
    ),
    index("communication_department_owner_idx").on(
      table.departmentId,
      table.ownerUserId
    ),
    uniqueIndex("communication_creation_request_unique").on(
      table.creationActorUserId,
      table.creationRequestId
    ),
    check(
      "communication_creation_request_check",
      sql`(${table.creationActorUserId} is null and ${table.creationRequestId} is null and ${table.creationRequestHash} is null)
        or (${table.creationActorUserId} is not null and ${table.creationRequestId} is not null
          and ${table.creationRequestHash} is not null and ${table.creationRequestHash} ~ '^[0-9a-f]{64}$')`
    ),
    check("communication_title_nonempty", sql`${table.title} ~ '[^[:space:]]'`),
    check(
      "communication_summary_check",
      sql`${table.summary} ~ '[^[:space:]]' and char_length(${table.summary}) <= 20000`
    ),
    check("communication_version_positive", sql`${table.version} > 0`),
    check(
      "communication_archive_state_check",
      sql`(${table.archivedAt} is null and ${table.archivedByUserId} is null)
        or (${table.archivedAt} is not null and ${table.archivedByUserId} is not null
          and ${table.archiveStartedAt} is null)`
    ),
  ]
);

/** 沟通标签按部门共享，名称忽略首尾空格和大小写。 */
export const communicationTag = pgTable(
  "communication_tag",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 64 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 64 })
      .generatedAlwaysAs(sql`lower(btrim((name)::text))`)
      .notNull(),
    color: varchar("color", { length: 7 }).default("#111111").notNull(),
    // 只有无法确定归属的旧标签保留 NULL。
    departmentId: text("department_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("communication_tag_department_normalized_name_unique").on(
      table.departmentId,
      table.normalizedName
    ),
    index("communication_tag_created_by_user_id_idx").on(table.createdByUserId),
    check(
      "communication_tag_name_nonempty",
      sql`${table.normalizedName} ~ '[^[:space:]]'`
    ),
    check(
      "communication_tag_color_check",
      sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`
    ),
  ]
);

/** 每条沟通只能关联同一标签一次。删除沟通时清理关联。 */
export const communicationTagAssignment = pgTable(
  "communication_tag_assignment",
  {
    communicationId: uuid("communication_id").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => communicationTag.id, { onDelete: "restrict" }),
  },
  (table) => [
    // 避免默认外键名被 PostgreSQL 截断，导致重复同步时重建。
    foreignKey({
      name: "communication_tag_assignment_communication_fk",
      columns: [table.communicationId],
      foreignColumns: [communication.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.communicationId, table.tagId] }),
    index("communication_tag_assignment_tag_idx").on(table.tagId),
  ]
);
