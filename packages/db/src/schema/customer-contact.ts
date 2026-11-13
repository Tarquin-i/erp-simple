import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
    // 后端用同一个版本号检测联系人改名和联系方式变更之间的并发冲突。
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
    index("customer_contact_customer_idx").on(table.customerId),
    check("customer_contact_name_nonempty", sql`btrim(${table.name}) <> ''`),
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
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 同一联系人每种联系方式最多一条。
    uniqueIndex("customer_contact_method_type_unique").on(
      table.contactId,
      table.type
    ),
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
