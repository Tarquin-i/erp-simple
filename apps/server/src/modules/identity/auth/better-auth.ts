import type { Database, DatabaseTransaction } from "@repo/db";
import * as schema from "@repo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * 将 PostgreSQL 的 Drizzle 实例接入 Better Auth，并启用适配器的事务支持。
 * @param db 应用数据库实例或调用方已开启的事务。
 * @returns 使用项目认证表定义的 Drizzle 适配器。
 */
export function createAuthAdapter(db: Database | DatabaseTransaction) {
  return drizzleAdapter(db, { provider: "pg", schema, transaction: true });
}

export function createPublicAuth(db: Database) {
  return betterAuth({
    database: createAuthAdapter(db),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
  });
}
