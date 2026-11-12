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

export const companyAdministrator = pgTable("company_administrator", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
