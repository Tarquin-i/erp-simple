import { isConstraintError } from "@repo/db";

import { readBusinessAccess } from "../../business/access";
import type { Database } from "../../identity/auth/better-auth";
import {
  findCustomerTag,
  insertCustomerTag,
  listCustomerTags,
  updateCustomerTagColor,
} from "../persistence/tags";
import { createCustomerError } from "./errors";

export function createTagUseCases(db: Database) {
  return {
    list: (input: { page: number; pageSize: number; search?: string }) =>
      listCustomerTags(db, input),
    async get(id: string) {
      const tag = await findCustomerTag(db, id);
      if (!tag) throw createCustomerError("tagNotFound");
      return tag;
    },
    async create(name: string, color: string | undefined) {
      try {
        return await insertCustomerTag(db, name, color);
      } catch (error) {
        if (
          isConstraintError(
            error,
            "23505",
            "customer_tag_normalized_name_unique"
          )
        ) {
          throw createCustomerError("tagNameExists");
        }
        throw error;
      }
    },
    async updateColor(input: {
      userId: string;
      id: string;
      color: string;
      expectedColor: string;
    }) {
      const { userId, id, color, expectedColor } = input;
      const access = await readBusinessAccess(db, userId);
      if (access.scope !== "company") {
        throw createCustomerError("tagColorForbidden");
      }

      const result = await updateCustomerTagColor(db, id, color, expectedColor);
      if (result.kind === "not-found") {
        throw createCustomerError("tagNotFound");
      }
      if (result.kind === "conflict") {
        throw createCustomerError("tagColorConflict", result.current);
      }
      return result.tag;
    },
  };
}
