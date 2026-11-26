import { defineConfig } from "drizzle-kit";

import { loadDatabaseEnv } from "./src/local-database";

loadDatabaseEnv();
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  out: "./drizzle",
  // db:push 和 db:studio 共用这个入口加载表定义。
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
