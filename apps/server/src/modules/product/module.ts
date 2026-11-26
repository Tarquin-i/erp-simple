import type { Database } from "@repo/db";
import { createProductUseCases } from "./application/products";

export function createProductModule(db: Database) {
  return {
    products: createProductUseCases(db),
  };
}

export type ProductModule = ReturnType<typeof createProductModule>;
