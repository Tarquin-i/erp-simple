import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { member, organization } from "./organization";

/**
 * 生成供 PostgreSQL 随机抽取一个字母的 SQL 表达式。
 * @param letters 代码内预设的非空候选字母串。
 * @returns SQL 表达式字符串，随机取值发生在数据库执行时。
 */
const randomLetter = (letters: string) =>
  `substr('${letters}'::text, random(1, ${letters.length}), 1)`;

const customerNumberSyllable = `${randomLetter("BDFGHJKLMNPRSTVZ")}, ${randomLetter("AEIOU")}`;

// 插入时未提供编号，PostgreSQL 默认生成 C、两组辅音加元音及两位数字组成的编号。
// 沿用 huivo-erp 的 PostgreSQL 17 表达式，便于 Drizzle 和 pg_get_expr 的结果比较。
const customerNumberDefault = sql.raw(
  `concat('C', ${customerNumberSyllable}, ${customerNumberSyllable}, lpad((random(0, 99))::text, 2, '0'::text))`
);

export const customer = pgTable(
  "customer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerNo: varchar("customer_no", { length: 7 })
      .default(customerNumberDefault)
      .notNull(),
    companyName: varchar("company_name", { length: 256 }).notNull(),
    normalizedCompanyName: varchar("normalized_company_name", { length: 256 })
      .generatedAlwaysAs(sql`lower(btrim((company_name)::text))`)
      .notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    remark: text("remark"),
    // 后端用版本号检测并发编辑，并在更新成功时递增。
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
    // 编号全局唯一，新建撞号时由后端重试。
    uniqueIndex("customer_customer_no_unique").on(table.customerNo),
    // 客户名称去掉首尾空格并转小写后，在同一部门内唯一。
    uniqueIndex("customer_department_name_unique").on(
      table.departmentId,
      table.normalizedCompanyName
    ),
    index("customer_department_owner_idx").on(
      table.departmentId,
      table.ownerUserId
    ),
    index("customer_owner_user_idx").on(table.ownerUserId),
    // 负责人必须属于客户部门，有客户归属的成员不能移除或转部。
    foreignKey({
      name: "customer_department_owner_member_fk",
      columns: [table.departmentId, table.ownerUserId],
      foreignColumns: [member.organizationId, member.userId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "customer_company_name_nonempty",
      sql`${table.normalizedCompanyName} <> ''`
    ),
  ]
);

// 客户渠道字典，以固定编码关联客户。
export const customerChannel = pgTable("customer_channel", {
  code: varchar("code", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  color: varchar("color", { length: 7 }).default("#111111").notNull(),
});

export const customerTag = pgTable(
  "customer_tag",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 64 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 64 })
      .generatedAlwaysAs(sql`lower(btrim((name)::text))`)
      .notNull(),
    color: varchar("color", { length: 7 }).default("#111111").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // 标签名称去掉首尾空格并转小写后，全局唯一。
    uniqueIndex("customer_tag_normalized_name_unique").on(table.normalizedName),
    check("customer_tag_name_nonempty", sql`${table.normalizedName} <> ''`),
    check(
      "customer_tag_color_check",
      sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`
    ),
  ]
);

// 每个客户只能关联同一渠道一次。删除客户时自动清理关联，已关联渠道不能直接删除。
export const customerChannelAssignment = pgTable(
  "customer_channel_assignment",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    channelCode: varchar("channel_code", { length: 64 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.customerId, table.channelCode] }),
    foreignKey({
      name: "customer_channel_assignment_channel_code_fk",
      columns: [table.channelCode],
      foreignColumns: [customerChannel.code],
    }).onDelete("restrict"),
    index("customer_channel_assignment_code_idx").on(table.channelCode),
  ]
);

// 每个客户只能关联同一标签一次。删除客户时自动清理关联，已关联标签不能直接删除。
export const customerTagAssignment = pgTable(
  "customer_tag_assignment",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => customerTag.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.customerId, table.tagId] }),
    index("customer_tag_assignment_tag_idx").on(table.tagId),
  ]
);
