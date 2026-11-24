import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { product } from "./product";

export interface PayoutDefinition {
  groups: {
    id: string;
    name: string;
    prizes: {
      id: string;
      name: string;
      amount: number;
      quantity: number;
    }[];
  }[];
}

export const payoutStatus = pgEnum("payout_status", ["active", "archived"]);

// 与表单的 String.trim() 使用相同的空白字符，避免首尾空白绕过去重。
const nameWhitespace = sql.raw(
  "'\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'"
);

/** 生成列和改名查重共用同一套去空白、转小写规则。 */
export function normalizePayoutName(name: SQLWrapper | string) {
  return sql`lower(btrim(${name}, ${nameWhitespace}) collate pg_catalog."und-x-icu")`;
}

/** Payout 归属产品。新建时奖项列表为空，奖项在详情里编辑。 */
export const payout = pgTable(
  "payout",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 128 }).notNull(),
    normalizedName: text("normalized_name")
      .generatedAlwaysAs(normalizePayoutName(sql.identifier("name")))
      .notNull(),
    ticketCount: integer("ticket_count").notNull(),
    // 币种在创建时从产品带入，票面售价单独保存。
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    unitPrice: numeric("unit_price").default("1").notNull(),
    definition: jsonb("definition")
      .$type<PayoutDefinition>()
      .default({ groups: [] })
      .notNull(),
    remark: text("remark").default("").notNull(),
    status: payoutStatus("status").default("active").notNull(),
    version: integer("version").default(1).notNull(),
    copiedFromPayoutId: uuid("copied_from_payout_id").references(
      (): AnyPgColumn => payout.id,
      { onDelete: "restrict" }
    ),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: varchar("creation_request_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("payout_product_status_created_idx").on(
      table.productId,
      table.status,
      table.createdAt,
      table.id
    ),
    uniqueIndex("payout_product_active_name_unique")
      .on(table.productId, table.normalizedName)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("payout_creation_request_unique").on(
      table.createdByUserId,
      table.creationRequestId
    ),
    check("payout_name_check", sql`${table.normalizedName} <> ''`),
    check(
      "payout_ticket_count_check",
      sql`${table.ticketCount} between 1 and 1000000`
    ),
    check(
      "payout_currency_code_check",
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`
    ),
    check(
      "payout_unit_price_check",
      sql`${table.unitPrice} > 0 and ${table.unitPrice} <= 100000
        and ${table.unitPrice} = trunc(${table.unitPrice}, 4)`
    ),
    check(
      "payout_definition_check",
      sql`jsonb_typeof(${table.definition} -> 'groups') is not distinct from 'array'`
    ),
    check(
      "payout_remark_length_check",
      sql`char_length(${table.remark}) <= 2000`
    ),
    check("payout_version_positive", sql`${table.version} > 0`),
    check(
      "payout_copy_source_check",
      sql`${table.copiedFromPayoutId} is distinct from ${table.id}`
    ),
    check(
      "payout_creation_request_check",
      sql`(${table.creationRequestId} is null and ${table.creationRequestHash} is null)
        or (${table.creationRequestId} is not null and ${table.creationRequestHash} is not null
          and ${table.creationRequestHash} ~ '^[0-9a-f]{64}$')`
    ),
  ]
);
