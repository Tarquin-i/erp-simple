import type { Database } from "../identity/auth/better-auth";
import { createPayoutUseCases } from "./application/payouts";

export function createPayoutModule(db: Database) {
  return {
    payouts: createPayoutUseCases(db),
  };
}

export type PayoutModule = ReturnType<typeof createPayoutModule>;
