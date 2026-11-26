import type { Database } from "@repo/db";
import { createContactUseCases } from "./application/contacts";
import { createOwnerOptionUseCases } from "./application/owner-options";
import { createProfileUseCases } from "./application/profiles";
import { createTagUseCases } from "./application/tags";
import { listCustomerChannels } from "./persistence/channels";

export function createCustomerModule(db: Database) {
  return {
    contacts: createContactUseCases(db),
    listChannels: () => listCustomerChannels(db),
    ownerOptions: createOwnerOptionUseCases(db),
    profiles: createProfileUseCases(db),
    tags: createTagUseCases(db),
  };
}

export type CustomerModule = ReturnType<typeof createCustomerModule>;
