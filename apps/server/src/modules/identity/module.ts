import type { Database } from "@repo/db";
import { createPublicAuth } from "./auth/better-auth";
import { createRequireAccountId } from "./auth/session";

export function createIdentityModule(db: Database) {
  const auth = createPublicAuth(db);
  return { auth, requireAccountId: createRequireAccountId(auth) };
}

export type IdentityModule = ReturnType<typeof createIdentityModule>;
