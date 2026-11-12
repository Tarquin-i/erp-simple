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
import { organization } from "./organization";

const randomLetter = (letters: string) =>
  `substr('${letters}'::text, random(1, ${letters.length}), 1)`;

const customerNumberSyllable = `${randomLetter("BDFGHJKLMNPRSTVZ")}, ${randomLetter("AEIOU")}`;

// Match huivo-erp's PostgreSQL 17 default so Drizzle can compare it with pg_get_expr.
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
    uniqueIndex("customer_customer_no_unique").on(table.customerNo),
    uniqueIndex("customer_department_name_unique").on(
      table.departmentId,
      table.normalizedCompanyName
    ),
    index("customer_department_owner_idx").on(
      table.departmentId,
      table.ownerUserId
    ),
    index("customer_owner_user_idx").on(table.ownerUserId),
    check(
      "customer_company_name_nonempty",
      sql`${table.normalizedCompanyName} <> ''`
    ),
  ]
);

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
    uniqueIndex("customer_tag_normalized_name_unique").on(table.normalizedName),
    check("customer_tag_name_nonempty", sql`${table.normalizedName} <> ''`),
    check(
      "customer_tag_color_check",
      sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`
    ),
  ]
);

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
