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
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function createAdapter(db: Database | Transaction) {
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

// Only the server API of this instance is used, within the caller's transaction.
export function createProvisioningAuth(tx: Transaction) {
  return betterAuth({
    database: createAdapter(tx),
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [departments],
  });
}
