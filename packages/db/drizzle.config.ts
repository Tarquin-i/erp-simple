import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

const serverEnvFile = "../../apps/server/.env";
if (!process.env.DATABASE_URL && existsSync(serverEnvFile)) {
  process.loadEnvFile?.(serverEnvFile);
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
