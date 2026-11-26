import { isConstraintError } from "@repo/db";
import type { Database } from "@repo/db";

import {
  readAccountRecordAccess,
  withRecordReadSnapshot,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { fail } from "../../../errors";
import {
  findTag,
  insertTag,
  selectTagPage,
  updateTagColor,
} from "../persistence/tags";
import { createTagConflict } from "./errors";

export function requireTagColorAccess(access: AccountRecordAccess) {
  if (access.scope !== "company")
    fail(403, "仅公司管理员可以修改共享标签颜色。");
}

export function createCommunicationTagUseCases(db: Database) {
  return {
    list(
      access: AccountRecordAccess,
      query: Parameters<typeof selectTagPage>[1]
    ) {
      return withRecordReadSnapshot(
        access.userId,
        (tx) => selectTagPage(tx, query),
        db
      );
    },
    async get(access: AccountRecordAccess, id: string) {
      const tag = await withRecordReadSnapshot(
        access.userId,
        (tx) => findTag(tx, id),
        db
      );
      if (!tag) fail(404, "标签不存在。");
      return tag;
    },
    async create(name: string, color: string | undefined) {
      try {
        return await insertTag(db, name, color);
      } catch (error) {
        if (
          isConstraintError(
            error,
            "23505",
            "communication_tag_normalized_name_unique"
          )
        ) {
          throw createTagConflict("tag_name_exists");
        }
        throw error;
      }
    },
    async updateColor(
      access: AccountRecordAccess,
      id: string,
      color: string,
      expectedColor: string
    ) {
      requireTagColorAccess(await readAccountRecordAccess(db, access.userId));
      const result = await updateTagColor(db, id, color, expectedColor);
      if (result.kind === "not-found") fail(404, "标签不存在。");
      if (result.kind === "conflict") {
        throw createTagConflict("tag_color_conflict", result.current);
      }
      return result.tag;
    },
  };
}
