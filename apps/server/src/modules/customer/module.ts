import type { Database } from "../identity/auth/better-auth";
import { createOwnerOptionUseCases } from "./application/owner-options";
import { createProfileUseCases } from "./application/profiles";
import { createTagUseCases } from "./application/tags";
import { listCustomerChannels } from "./persistence/channels";

export function createCustomerModule(db: Database) {
  return {
    listChannels: () => listCustomerChannels(db),
    ownerOptions: createOwnerOptionUseCases(db),
    profiles: createProfileUseCases(db),
    tags: createTagUseCases(db),
  };
}

export type CustomerModule = ReturnType<typeof createCustomerModule>;
