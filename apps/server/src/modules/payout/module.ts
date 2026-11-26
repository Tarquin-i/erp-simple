import type { Database } from "@repo/db";
import { createPayoutUseCases } from "./application/payouts";

export function createPayoutModule(db: Database) {
  return {
    payouts: createPayoutUseCases(db),
  };
}

export type PayoutModule = ReturnType<typeof createPayoutModule>;
