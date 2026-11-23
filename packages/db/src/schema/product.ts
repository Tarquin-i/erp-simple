import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
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

export const productType = pgEnum("product_type", [
  "pull-tab",
  "lottery",
  "scratch-card",
  "hang-tag",
  "recharge-card",
  "tax-stamp",
  "user-defined",
]);

export const productStatus = pgEnum("product_status", ["active", "archived"]);

const presetTypeNames = sql.raw(
  [
    ...productType.enumValues.filter((type) => type !== "user-defined"),
    "揭开卡",
    "彩票",
    "刮刮卡",
    "吊牌",
    "充值卡",
    "税票",
  ]
    .map((name) => `'${name}'`)
    .join(", ")
);

const randomLetter = (letters: string) =>
  `substr('${letters}'::text, random(1, ${letters.length}), 1)`;
const numberSyllable = `${randomLetter("BDFGHJKLMNPRSTVZ")}, ${randomLetter("AEIOU")}`;
const productNumberDefault = sql.raw(
  `concat('P', ${numberSyllable}, ${numberSyllable}, lpad((random(0, 99))::text, 2, '0'::text))`
);

// 与参考项目的名称 trim 规则一致，固定大小写转换规则。
const nameWhitespace =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const customTypeWhitespace = `\u0085${nameWhitespace}`;
const trimProductText = (value: SQLWrapper, whitespace = nameWhitespace) =>
  sql`btrim(${value}, ${sql.raw(`'${whitespace}'`)})`;
const normalizeProductText = (value: SQLWrapper, whitespace = nameWhitespace) =>
  sql`lower(${trimProductText(value, whitespace)} collate pg_catalog."und-x-icu")`;

/** 产品直接归属客户，创建者用于审计和识别同一次提交。 */
export const product = pgTable(
  "product",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productNo: varchar("product_no", { length: 7 })
      .default(productNumberDefault)
      .notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 128 }).notNull(),
    englishName: varchar("english_name", { length: 128 }).notNull(),
    normalizedName: text("normalized_name")
      .generatedAlwaysAs(normalizeProductText(sql.identifier("name")))
      .notNull(),
    normalizedEnglishName: text("normalized_english_name")
      .generatedAlwaysAs(normalizeProductText(sql.identifier("english_name")))
      .notNull(),
    productType: productType("product_type").notNull(),
    customerDefinedType: varchar("customer_defined_type", { length: 64 }),
    // 预设类型使用空字符串参与唯一索引，同名自定义类型忽略大小写。
    normalizedCustomerDefinedType: text("normalized_customer_defined_type")
      .generatedAlwaysAs(
        sql`coalesce(${normalizeProductText(sql.identifier("customer_defined_type"), customTypeWhitespace)}, '')`
      )
      .notNull(),
    specification: varchar("specification", { length: 128 }).notNull(),
    packagingSpecification: varchar("packaging_specification", {
      length: 128,
    }).notNull(),
    colorCount: varchar("color_count", { length: 32 }).notNull(),
    paperType: varchar("paper_type", { length: 64 }).notNull(),
    finishedSize: varchar("finished_size", { length: 64 }).notNull(),
    finalMolding: varchar("final_molding", { length: 64 }).notNull(),
    surfaceTreatment: varchar("surface_treatment", { length: 64 }).notNull(),
    variableColor: varchar("variable_color", { length: 64 }).notNull(),
    variationMethod: varchar("variation_method", { length: 64 }).notNull(),
    dieCutDirection: varchar("die_cut_direction", { length: 32 }),
    peelOffQuantity: integer("peel_off_quantity"),
    scratchOffArea: varchar("scratch_off_area", { length: 64 }),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    // 保留原始精度，便于拒绝超出四位小数的金额。
    unitPrice: numeric("unit_price").notNull(),
    remark: text("remark").default("").notNull(),
    status: productStatus("status").default("active").notNull(),
    version: integer("version").default(1).notNull(),
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
  (table) => {
    const customType = table.customerDefinedType;
    const trimmedCustomType = trimProductText(customType, customTypeWhitespace);
    const active = sql`${table.status} = 'active'`;
    const requiredTextFields = [
      table.name,
      table.specification,
      table.packagingSpecification,
      table.colorCount,
      table.paperType,
      table.finishedSize,
      table.finalMolding,
      table.surfaceTreatment,
      table.variableColor,
      table.variationMethod,
    ];

    return [
      uniqueIndex("product_product_no_unique").on(table.productNo),
      uniqueIndex("product_customer_active_name_unique")
        .on(
          table.customerId,
          table.productType,
          table.normalizedCustomerDefinedType,
          table.normalizedName
        )
        .where(active),
      uniqueIndex("product_customer_active_english_name_unique")
        .on(
          table.customerId,
          table.productType,
          table.normalizedCustomerDefinedType,
          table.normalizedEnglishName
        )
        .where(active),
      uniqueIndex("product_creation_request_unique").on(
        table.createdByUserId,
        table.creationRequestId
      ),
      index("product_status_created_idx").on(
        table.status,
        table.createdAt,
        table.id
      ),
      index("product_customer_status_created_idx").on(
        table.customerId,
        table.status,
        table.createdAt,
        table.id
      ),
      check(
        "product_required_text_check",
        sql.join(
          requiredTextFields.map(
            (field) => sql`${trimProductText(field)} <> ''`
          ),
          sql` and `
        )
      ),
      check(
        "product_english_name_check",
        sql`char_length(${trimProductText(table.englishName)}) >= 3`
      ),
      check(
        "product_custom_type_check",
        sql`(${table.productType} = 'user-defined' and ${customType} is not null
          and ${customType} = ${trimmedCustomType} and ${customType} <> ''
          and ${table.normalizedCustomerDefinedType} not in (${presetTypeNames}))
        or (${table.productType} <> 'user-defined' and ${customType} is null)`
      ),
      check(
        "product_pull_tab_fields_check",
        sql`(${table.productType} = 'pull-tab'
          and ${table.peelOffQuantity} is not null and ${table.peelOffQuantity} > 0
          and ${table.dieCutDirection} is not null and ${trimProductText(table.dieCutDirection)} <> '')
        or (${table.productType} <> 'pull-tab' and ${table.peelOffQuantity} is null
          and ${table.dieCutDirection} is null)`
      ),
      check(
        "product_scratch_off_area_check",
        sql`(${table.productType} in ('lottery', 'scratch-card')
          and ${table.scratchOffArea} is not null and ${trimProductText(table.scratchOffArea)} <> '')
        or (${table.productType} not in ('lottery', 'scratch-card') and ${table.scratchOffArea} is null)`
      ),
      check(
        "product_currency_code_check",
        sql`${table.currencyCode} ~ '^[A-Z]{3}$'`
      ),
      check(
        "product_unit_price_check",
        sql`${table.unitPrice} > 0 and ${table.unitPrice} <= 100000
          and ${table.unitPrice} = trunc(${table.unitPrice}, 4)`
      ),
      check(
        "product_remark_length_check",
        sql`char_length(${table.remark}) <= 4096`
      ),
      check("product_version_positive", sql`${table.version} > 0`),
      check(
        "product_creation_request_check",
        sql`(${table.creationRequestId} is null and ${table.creationRequestHash} is null)
          or (${table.creationRequestId} is not null and ${table.creationRequestHash} is not null
            and ${table.creationRequestHash} ~ '^[0-9a-f]{64}$')`
      ),
    ];
  }
);
