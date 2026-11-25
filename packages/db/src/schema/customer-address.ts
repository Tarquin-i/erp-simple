import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
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

import { customer } from "./customer";

export const customerAddressStatus = pgEnum("customer_address_status", [
  "active",
  "archived",
]);

/** 客户收货地址，收货人和联系电话记录在地址上，归属随客户管理。 */
export const customerAddress = pgTable(
  "customer_address",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    recipientName: varchar("recipient_name", { length: 128 }).notNull(),
    phone: varchar("phone", { length: 64 }).notNull(),
    // 保留用户填写的原号码，同时记录规范化的国际手机号。
    phoneNormalized: varchar("phone_normalized", { length: 16 }).notNull(),
    countryCode: char("country_code", { length: 2 }).default("CN").notNull(),
    province: varchar("province", { length: 128 }),
    city: varchar("city", { length: 128 }).notNull(),
    district: varchar("district", { length: 128 }),
    addressLine1: varchar("address_line1", { length: 256 }).notNull(),
    addressLine2: varchar("address_line2", { length: 256 }),
    postalCode: varchar("postal_code", { length: 32 }),
    remark: text("remark").default("").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    status: customerAddressStatus("status").default("active").notNull(),
    // 历史地址没有提交标识。新建时用于在断线后识别同一次提交。
    creationActorUserId: text("creation_actor_user_id"),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: varchar("creation_request_hash", { length: 64 }),
    // 后端更新地址时校验并递增版本号。
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
    foreignKey({
      name: "customer_address_customer_fk",
      columns: [table.customerId],
      foreignColumns: [customer.id],
    }).onDelete("cascade"),
    index("customer_address_customer_status_updated_idx").on(
      table.customerId,
      table.status,
      table.updatedAt,
      table.id
    ),
    index("customer_address_status_default_updated_idx").on(
      table.status,
      table.isDefault,
      table.updatedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst()
    ),
    // 同一客户最多一条默认地址，切换默认和归档递补由后端事务处理。
    uniqueIndex("customer_address_customer_default_unique")
      .on(table.customerId)
      .where(sql`${table.isDefault} = true`),
    uniqueIndex("customer_address_creation_request_unique").on(
      table.creationActorUserId,
      table.creationRequestId
    ),
    check(
      "customer_address_creation_request_check",
      sql`(${table.creationActorUserId} is null and ${table.creationRequestId} is null and ${table.creationRequestHash} is null)
        or (${table.creationActorUserId} is not null and ${table.creationRequestId} is not null
          and ${table.creationRequestHash} is not null and ${table.creationRequestHash} ~ '^[0-9a-f]{64}$')`
    ),
    check(
      "customer_address_default_active_check",
      sql`${table.isDefault} = false or ${table.status} = 'active'`
    ),
    check(
      "customer_address_country_code_check",
      sql`${table.countryCode} ~ '^[A-Z]{2}$'`
    ),
    check(
      "customer_address_required_text_check",
      sql`${table.recipientName} ~ '[^[:space:]]'
        and ${table.phone} ~ '[^[:space:]]'
        and (${table.province} is null or ${table.province} ~ '[^[:space:]]')
        and ${table.city} ~ '[^[:space:]]'
        and ${table.addressLine1} ~ '[^[:space:]]'`
    ),
    check(
      "customer_address_phone_normalized_check",
      sql`${table.phoneNormalized} ~ '^[+][1-9][0-9]{1,14}$'`
    ),
    check("customer_address_version_positive", sql`${table.version} > 0`),
  ]
);
