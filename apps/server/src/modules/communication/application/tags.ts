import { isConstraintError } from "@repo/db";
import type { Database } from "@repo/db";

import {
  lockDepartment,
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

type TagRow = Awaited<ReturnType<typeof lockTag>> & {
  departmentName?: string | null;
};

function presentTag(
  { id, name, color, createdAt, departmentId, departmentName }: TagRow,
  access: AccountRecordAccess
) {
  if (access.scope !== "company" && access.departmentId !== departmentId) {
    fail(404, "标签不存在。");
  }
  return {
    id,
    name,
    color,
    createdAt,
    departmentId,
    departmentName,
    canManage: true,
  };
}

function resolveDepartment(access: AccountRecordAccess, requested?: string) {
  if (access.scope === "company") return requested;
  if (requested !== undefined && requested !== access.departmentId) {
    fail(403, "只能访问当前所属部门的标签。");
  }
  return access.departmentId;
}

function translateTagNameError(error: unknown): never {
  if (
    isConstraintError(
      error,
      "23505",
      "communication_tag_department_normalized_name_unique"
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
        async (tx, currentAccess) => {
          const page = await selectTagPage(tx, {
            ...query,
            departmentId: resolveDepartment(currentAccess, query.departmentId),
          });
          return {
            ...page,
            tags: page.tags.map((tag) => presentTag(tag, currentAccess)),
          };
        },
        db
      );
    },
    get(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          const tag = await findTag(tx, id);
          if (!tag) fail(404, "标签不存在。");
          return presentTag(tag, currentAccess);
        },
        db
      );
    },
    usage(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          const tag = await findTag(tx, id);
          if (!tag) fail(404, "标签不存在。");
          presentTag(tag, currentAccess);
          return { references: await countTagReferences(tx, id) };
        },
        db
      );
    },
    create(
      access: AccountRecordAccess,
      input: { name: string; color?: string; departmentId?: string }
    ) {
      const departmentId = resolveDepartment(access, input.departmentId);
      if (departmentId === undefined) fail(400, "请选择标签所属部门。");
      return db
        .transaction(async (tx) => {
          await lockDepartment(tx, departmentId, "share");
          const currentAccess = await readAccountRecordAccess(
            tx,
            access.userId
          );
          resolveDepartment(currentAccess, departmentId);
          const tag = await insertTag(tx, {
            name: input.name,
            color: input.color,
            departmentId,
            createdByUserId: currentAccess.userId,
          });
          return presentTag(tag, currentAccess);
        })
        .catch(translateTagNameError);
    },
    update(access: AccountRecordAccess, id: string, input: TagEdit) {
      const { color, expectedColor, name, expectedName } = input;
      const colorOnly = name === undefined;
      return db
        .transaction(async (tx) => {
          const current = await lockTag(tx, id, resolveDepartment(access));
          if (!current) fail(404, "标签不存在。");

          const currentAccess = await readAccountRecordAccess(
            tx,
            access.userId
          );
          const existingTag = presentTag(current, currentAccess);

          const currentColor = current.color.toLowerCase();
          const currentName = current.name.trim();
          // 上次保存成功但响应丢失时，原样重试直接返回已保存的标签。
          if (
            currentColor === color.toLowerCase() &&
            (colorOnly || currentName === name)
          ) {
            return existingTag;
          }
          if (
            currentColor !== expectedColor.toLowerCase() ||
            (!colorOnly && currentName !== expectedName)
          ) {
            throw createTagConflict(
              colorOnly ? "tag_color_conflict" : "tag_conflict",
              existingTag
            );
          }

          return presentTag(
            await updateTag(tx, id, { name, color }),
            currentAccess
          );
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
        const current = await lockTag(tx, id, resolveDepartment(access));
        if (!current) fail(404, "标签不存在。");

        const currentAccess = await readAccountRecordAccess(tx, access.userId);
        const existingTag = presentTag(current, currentAccess);
        if (
          current.name.trim() !== expectedName ||
          current.color.toLowerCase() !== expectedColor.toLowerCase()
        ) {
          throw createTagConflict("tag_conflict", existingTag);
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
