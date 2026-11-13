import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

const serverEnvFile = "../../apps/server/.env";
// 优先使用环境中已有的 DATABASE_URL，缺失时从后端 .env 读取。
if (!process.env.DATABASE_URL && existsSync(serverEnvFile)) {
  process.loadEnvFile?.(serverEnvFile);
}

export default defineConfig({
  out: "./drizzle",
  // db:push 和 db:studio 共用这个入口加载表定义。
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
