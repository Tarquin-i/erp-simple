import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization } from "./organization";

/** 记录拥有公司级管理权限的用户，每位用户最多一条管理员记录。 */
export const companyAdministrator = pgTable("company_administrator", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** 入部申请及审核记录，每位用户同时最多有一条待审申请。 */
export const departmentApplication = pgTable(
  "department_application",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .default("pending")
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // 审核人删除后保留审核结果，清空审核人引用。
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("department_application_pending_user_unique")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("department_application_user_submitted_at_idx").on(
      table.userId,
      table.submittedAt
    ),
    index("department_application_department_status_idx").on(
      table.organizationId,
      table.status,
      table.submittedAt
    ),
    // 待审时审核字段为空，通过或拒绝后必须记录审核时间。
    check(
      "department_application_review_state_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.reviewedAt} is null
        and ${table.reviewedByUserId} is null
      ) or (
        ${table.status} in ('approved', 'rejected')
        and ${table.reviewedAt} is not null
      )`
    ),
  ]
);
