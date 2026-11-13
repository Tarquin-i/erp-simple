import { createDatabase } from "@repo/db";
import * as schema from "@repo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { memberAc } from "better-auth/plugins/organization/access";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in apps/server/.env");
}

export const database = createDatabase(databaseUrl);

type Database = typeof database.db;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * 将 PostgreSQL 的 Drizzle 实例接入 Better Auth，并启用适配器的事务支持。
 * @param db 应用数据库实例或调用方已开启的事务。
 * @returns 使用项目认证表定义的 Drizzle 适配器。
 */
function createAdapter(db: Database | DatabaseTransaction) {
  return drizzleAdapter(db, { provider: "pg", schema, transaction: true });
}

export const auth = betterAuth({
  database: createAdapter(database.db),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
});

const departments = organization({
  allowUserToCreateOrganization: false,
  membershipLimit: Number.POSITIVE_INFINITY,
  roles: { member: memberAc, supervisor: memberAc },
});

/**
 * 创建内部开户和入部使用的 Better Auth 实例，关闭注册后自动登录。
 * @param tx 调用方已开启的数据库事务，认证写入和业务写入共用它。
 * @returns 绑定到该事务的 Better Auth 实例，供服务端调用其 `api`。
 */
export function createProvisioningAuth(tx: DatabaseTransaction) {
  return betterAuth({
    database: createAdapter(tx),
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [departments],
  });
}
