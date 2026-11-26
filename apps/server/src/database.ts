import { createDatabase } from "@repo/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in apps/server/.env");
}

export const database = createDatabase(databaseUrl);
