import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { customer } from "./customer";

// 数据库限定联系方式类型，电话和邮箱等具体格式由后端校验。
export const customerContactMethodType = pgEnum(
  "customer_contact_method_type",
  [
    "phone",
    "email",
    "wechat",
    "whatsapp",
    "linkedin",
    "kingwin_alibaba",
    "kingwin_international_station",
    "huivo_international_station",
  ]
);

export const customerContact = pgTable(
  "customer_contact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    // 历史记录可留空，新增记录保留原始提交标识和内容摘要。
    creationActorUserId: text("creation_actor_user_id"),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: varchar("creation_request_hash", { length: 64 }),
    // 改名、新增、删除和切换主要联系方式时校验联系人版本。
    version: integer("version").default(1).notNull(),
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
    index("customer_contact_customer_idx").on(table.customerId),
    uniqueIndex("customer_contact_creation_request_unique").on(
      table.creationActorUserId,
      table.creationRequestId
    ),
    check(
      "customer_contact_creation_request_check",
      sql`(${table.creationActorUserId} is null and ${table.creationRequestId} is null and ${table.creationRequestHash} is null)
        or (${table.creationActorUserId} is not null and ${table.creationRequestId} is not null
          and ${table.creationRequestHash} is not null and ${table.creationRequestHash} ~ '^[0-9a-f]{64}$')`
    ),
    check("customer_contact_name_nonempty", sql`btrim(${table.name}) <> ''`),
    check(
      "customer_contact_archive_actor_check",
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`
    ),
  ]
);

export const customerContactMethod = pgTable(
  "customer_contact_method",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => customerContact.id, { onDelete: "cascade" }),
    type: customerContactMethodType("type").notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    normalizedEmail: text("normalized_email").generatedAlwaysAs(
      // 用普通列索引，避免 Drizzle 对同一表达式索引反复重建。
      sql.raw(`CASE
        WHEN (type = 'email'::customer_contact_method_type)
        THEN lower((regexp_replace((value)::text, '^[[:space:]]+|[[:space:]]+$'::text, ''::text, 'g'::text) COLLATE "C"))
        ELSE NULL::text
      END`)
    ),
    isPrimary: boolean("is_primary").default(false).notNull(),
    // 普通编辑按联系方式 ID 核对版本，其他联系方式的改动不阻止保存。
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("customer_contact_method_contact_idx").on(table.contactId),
    // 邮箱按同一联系人的规范化地址去重，其他方式仍按类型唯一。
    uniqueIndex("customer_contact_method_non_email_type_unique")
      .on(table.contactId, table.type)
      .where(sql`${table.type} <> 'email'`),
    uniqueIndex("customer_contact_method_email_unique")
      .on(table.contactId, table.normalizedEmail)
      .where(sql`${table.normalizedEmail} is not null`),
    // 仅对标记为主要的记录做唯一校验，每位联系人最多一条。
    uniqueIndex("customer_contact_method_primary_unique")
      .on(table.contactId)
      .where(sql`${table.isPrimary} = true`),
    check(
      "customer_contact_method_value_nonempty",
      sql`btrim(${table.value}) <> ''`
    ),
  ]
);
