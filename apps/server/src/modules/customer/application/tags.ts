import { isConstraintError } from "@repo/db";
import type { Database } from "@repo/db";

import { ApplicationError } from "../../../errors";
import {
  readAccountRecordAccess,
  withRecordReadSnapshot,
} from "../../organization";
import {
  countCustomerTagReferences,
  deleteCustomerTag,
  findCustomerTag,
  insertCustomerTag,
  listCustomerTags,
  lockCustomerTag,
  updateCustomerTag,
} from "../persistence/tags";
import { createCustomerError } from "./errors";

type TagEdit = { color: string; expectedColor: string } & (
  | { name: string; expectedName: string }
  | { name?: undefined; expectedName?: undefined }
);

function translateTagNameError(error: unknown): never {
  if (
    isConstraintError(error, "23505", "customer_tag_normalized_name_unique")
  ) {
    throw createCustomerError("tagNameExists");
  }
  throw error;
}

export function createTagUseCases(db: Database) {
  return {
    list: (input: { page: number; pageSize: number; search?: string }) =>
      listCustomerTags(db, input),
    async get(id: string) {
      const tag = await findCustomerTag(db, id);
      if (!tag) throw createCustomerError("tagNotFound");
      return tag;
    },
    usage(userId: string, id: string) {
      return withRecordReadSnapshot(
        userId,
        async (tx, access) => {
          if (access.scope !== "company") {
            throw createCustomerError("tagManagementForbidden");
          }
          if (!(await findCustomerTag(tx, id))) {
            throw createCustomerError("tagNotFound");
          }
          return { references: await countCustomerTagReferences(tx, id) };
        },
        db
      );
    },
    create(name: string, color: string | undefined) {
      return insertCustomerTag(db, name, color).catch(translateTagNameError);
    },
    update(userId: string, id: string, input: TagEdit) {
      const { color, expectedColor, name, expectedName } = input;
      const colorOnly = name === undefined;
      return db
        .transaction(async (tx) => {
          const access = await readAccountRecordAccess(tx, userId);
          if (access.scope !== "company") {
            throw createCustomerError(
              colorOnly ? "tagColorForbidden" : "tagManagementForbidden"
            );
          }

          const current = await lockCustomerTag(tx, id);
          if (!current) throw createCustomerError("tagNotFound");

          const currentColor = current.color.toLowerCase();
          const currentName = current.name.trim();
          // 上次保存成功但响应丢失时，原样重试直接返回已保存的标签。
          if (
            currentColor === color.toLowerCase() &&
            (colorOnly || currentName === name)
          ) {
            return current;
          }
          if (
            currentColor !== expectedColor.toLowerCase() ||
            (!colorOnly && currentName !== expectedName)
          ) {
            throw createCustomerError(
              colorOnly ? "tagColorConflict" : "tagConflict",
              current
            );
          }

          return updateCustomerTag(tx, id, { name, color });
        })
        .catch(translateTagNameError);
    },
    remove(input: {
      userId: string;
      id: string;
      expectedName: string;
      expectedColor: string;
    }) {
      const { userId, id, expectedName, expectedColor } = input;
      return db.transaction(async (tx) => {
        const access = await readAccountRecordAccess(tx, userId);
        if (access.scope !== "company") {
          throw createCustomerError("tagManagementForbidden");
        }

        const current = await lockCustomerTag(tx, id);
        if (!current) throw createCustomerError("tagNotFound");
        if (
          current.name.trim() !== expectedName ||
          current.color.toLowerCase() !== expectedColor.toLowerCase()
        ) {
          throw createCustomerError("tagConflict", current);
        }

        // 锁住标签后再查询关联，外键会等待此事务结束才允许新增引用。
        const references = await countCustomerTagReferences(tx, id);
        if (references > 0) {
          throw new ApplicationError(
            409,
            `此标签已被 ${references} 条记录引用，请先解除关联再删除。`,
            { code: "tag_in_use", current: { references } }
          );
        }
        await deleteCustomerTag(tx, id);
      });
    },
  };
}
