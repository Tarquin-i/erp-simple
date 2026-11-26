import type { Database } from "../identity/auth/better-auth";
import { listCustomerChannels } from "./persistence/channels";

export function createCustomerModule(db: Database) {
  return {
    listChannels: () => listCustomerChannels(db),
  };
}

export type CustomerModule = ReturnType<typeof createCustomerModule>;
