import { isConstraintError } from "@repo/db";
import type { Database } from "@repo/db";

import { ApplicationError } from "../../../errors";
import {
  lockDepartment,
  readAccountRecordAccess,
  withRecordReadSnapshot,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
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

type TagRow = Awaited<ReturnType<typeof lockCustomerTag>> & {
  departmentName?: string | null;
};

function presentTag(
  { id, name, color, createdAt, departmentId, departmentName }: TagRow,
  access: AccountRecordAccess
) {
  if (access.scope !== "company" && access.departmentId !== departmentId) {
    throw createCustomerError("tagNotFound");
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
    throw createCustomerError("tagDepartmentForbidden");
  }
  return access.departmentId;
}

function translateTagNameError(error: unknown): never {
  if (
    isConstraintError(
      error,
      "23505",
      "customer_tag_department_normalized_name_unique"
    )
  ) {
    throw createCustomerError("tagNameExists");
  }
  throw error;
}

export function createTagUseCases(db: Database) {
  return {
    list(userId: string, input: Parameters<typeof listCustomerTags>[1]) {
      return withRecordReadSnapshot(
        userId,
        async (tx, access) => {
          const page = await listCustomerTags(tx, {
            ...input,
            departmentId: resolveDepartment(access, input.departmentId),
          });
          return {
            ...page,
            tags: page.tags.map((tag) => presentTag(tag, access)),
          };
        },
        db
      );
    },
    get(userId: string, id: string) {
      return withRecordReadSnapshot(
        userId,
        async (tx, access) => {
          const tag = await findCustomerTag(tx, id);
          if (!tag) throw createCustomerError("tagNotFound");
          return presentTag(tag, access);
        },
        db
      );
    },
    usage(userId: string, id: string) {
      return withRecordReadSnapshot(
        userId,
        async (tx, access) => {
          const tag = await findCustomerTag(tx, id);
          if (!tag) throw createCustomerError("tagNotFound");
          presentTag(tag, access);
          return { references: await countCustomerTagReferences(tx, id) };
        },
        db
      );
    },
    create(
      access: AccountRecordAccess,
      input: { name: string; color?: string; departmentId?: string }
    ) {
      const departmentId = resolveDepartment(access, input.departmentId);
      if (departmentId === undefined) {
        throw new ApplicationError(400, "请选择标签所属部门。");
      }
      return db
        .transaction(async (tx) => {
          await lockDepartment(tx, departmentId, "share");
          const freshAccess = await readAccountRecordAccess(tx, access.userId);
          resolveDepartment(freshAccess, departmentId);
          const tag = await insertCustomerTag(tx, {
            name: input.name,
            color: input.color,
            departmentId,
            createdByUserId: freshAccess.userId,
          });
          return presentTag(tag, freshAccess);
        })
        .catch(translateTagNameError);
    },
    update(access: AccountRecordAccess, id: string, input: TagEdit) {
      const { color, expectedColor, name, expectedName } = input;
      const colorOnly = name === undefined;
      return db
        .transaction(async (tx) => {
          const current = await lockCustomerTag(
            tx,
            id,
            resolveDepartment(access)
          );
          if (!current) throw createCustomerError("tagNotFound");

          const freshAccess = await readAccountRecordAccess(tx, access.userId);
          const existingTag = presentTag(current, freshAccess);

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
            throw createCustomerError(
              colorOnly ? "tagColorConflict" : "tagConflict",
              existingTag
            );
          }

          return presentTag(
            await updateCustomerTag(tx, id, { name, color }),
            freshAccess
          );
        })
        .catch(translateTagNameError);
    },
    remove(input: {
      access: AccountRecordAccess;
      id: string;
      expectedName: string;
      expectedColor: string;
    }) {
      const { access, id, expectedName, expectedColor } = input;
      return db.transaction(async (tx) => {
        const current = await lockCustomerTag(
          tx,
          id,
          resolveDepartment(access)
        );
        if (!current) throw createCustomerError("tagNotFound");

        const freshAccess = await readAccountRecordAccess(tx, access.userId);
        const existingTag = presentTag(current, freshAccess);

        if (
          current.name.trim() !== expectedName ||
          current.color.toLowerCase() !== expectedColor.toLowerCase()
        ) {
          throw createCustomerError("tagConflict", existingTag);
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
