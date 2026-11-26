import type { Database } from "@repo/db";
import { createDeliveryAddressUseCases } from "./application/delivery-addresses";

export function createAddressModule(db: Database) {
  return {
    deliveryAddresses: createDeliveryAddressUseCases(db),
  };
}

export type AddressModule = ReturnType<typeof createAddressModule>;
