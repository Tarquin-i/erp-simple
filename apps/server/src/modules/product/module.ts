import type { Database } from "../identity/auth/better-auth";
import { createProductUseCases } from "./application/products";

export function createProductModule(db: Database) {
  return {
    products: createProductUseCases(db),
  };
}

export type ProductModule = ReturnType<typeof createProductModule>;
