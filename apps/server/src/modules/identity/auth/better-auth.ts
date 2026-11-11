import { createDatabase } from "@repo/db";
import * as schema from "@repo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in apps/server/.env");
}

export const database = createDatabase(databaseUrl);

export const auth = betterAuth({
  database: drizzleAdapter(database.db, {
    provider: "pg",
    schema,
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
});
