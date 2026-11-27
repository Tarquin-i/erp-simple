import { isConstraintError } from "@repo/db";
import type { Database } from "@repo/db";

import {
  readAccountRecordAccess,
  withRecordReadSnapshot,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { ApplicationError, fail } from "../../../errors";
import {
  countTagReferences,
  deleteTag,
  findTag,
  insertTag,
  lockTag,
  selectTagPage,
  updateTag,
} from "../persistence/tags";
import { createTagConflict } from "./errors";

type TagEdit = { color: string; expectedColor: string } & (
  | { name: string; expectedName: string }
  | { name?: undefined; expectedName?: undefined }
);

export function requireTagManagementAccess(
  access: AccountRecordAccess,
  colorOnly = false
) {
  if (access.scope !== "company") {
    fail(
      403,
      colorOnly
        ? "仅公司管理员可以修改共享标签颜色。"
        : "仅公司管理员可以编辑或删除共享标签。"
    );
  }
}

function translateTagNameError(error: unknown): never {
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
    usage(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          requireTagManagementAccess(currentAccess);
          if (!(await findTag(tx, id))) fail(404, "标签不存在。");
          return { references: await countTagReferences(tx, id) };
        },
        db
      );
    },
    create(name: string, color: string | undefined) {
      return insertTag(db, name, color).catch(translateTagNameError);
    },
    update(access: AccountRecordAccess, id: string, input: TagEdit) {
      const { color, expectedColor, name, expectedName } = input;
      const colorOnly = name === undefined;
      return db
        .transaction(async (tx) => {
          const currentAccess = await readAccountRecordAccess(
            tx,
            access.userId
          );
          requireTagManagementAccess(currentAccess, colorOnly);

          const current = await lockTag(tx, id);
          if (!current) fail(404, "标签不存在。");

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
            throw createTagConflict(
              colorOnly ? "tag_color_conflict" : "tag_conflict",
              current
            );
          }

          return updateTag(tx, id, { name, color });
        })
        .catch(translateTagNameError);
    },
    remove(
      access: AccountRecordAccess,
      id: string,
      {
        expectedName,
        expectedColor,
      }: { expectedName: string; expectedColor: string }
    ) {
      return db.transaction(async (tx) => {
        requireTagManagementAccess(
          await readAccountRecordAccess(tx, access.userId)
        );

        const current = await lockTag(tx, id);
        if (!current) fail(404, "标签不存在。");
        if (
          current.name.trim() !== expectedName ||
          current.color.toLowerCase() !== expectedColor.toLowerCase()
        ) {
          throw createTagConflict("tag_conflict", current);
        }

        // 锁住标签后再查询关联，外键会等待此事务结束才允许新增引用。
        const references = await countTagReferences(tx, id);
        if (references > 0) {
          throw new ApplicationError(
            409,
            `此标签已被 ${references} 条记录引用，请先解除关联再删除。`,
            { code: "tag_in_use", current: { references } }
          );
        }
        await deleteTag(tx, id);
      });
    },
  };
}
