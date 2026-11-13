import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/** 每条 Better Auth 组织记录对应一个 ERP 部门。 */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** 部门成员及其角色。每位用户最多加入一个部门，每个部门最多一名主管。 */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .unique("member_user_id_unique")
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["member", "supervisor"] })
      .default("member")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // 客户负责人外键同时引用成员的部门和用户 ID。
    unique("member_organization_user_unique").on(
      table.organizationId,
      table.userId
    ),
    index("member_organization_id_idx").on(table.organizationId),
    uniqueIndex("member_department_supervisor_unique")
      .on(table.organizationId)
      .where(sql`${table.role} = 'supervisor'`),
    check("member_role_check", sql`${table.role} in ('member', 'supervisor')`),
  ]
);

/** Better Auth 组织插件的邀请表。ERP 入部申请使用 department_application。 */
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);
