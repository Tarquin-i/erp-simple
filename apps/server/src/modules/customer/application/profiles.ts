import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";

import { ApplicationError, failVersionConflict } from "../../../errors";
import {
  lockDepartment,
  readAccountRecordAccess,
  withRecordReadSnapshot,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import {
  lockCustomerForWrite,
  requireAssignableOwner,
} from "../persistence/profile-write-access";
import {
  archiveCustomerProfile,
  findCustomerProfile,
  hasActiveCustomerNameConflict,
  hasActiveCustomerProduct,
  insertCustomerProfile,
  lockCustomerCreateRequest,
  selectCustomerPage,
  updateCustomerProfile,
} from "../persistence/profiles";
import type {
  CustomerFilters,
  CustomerWriteInput,
} from "../persistence/profiles";
import { selectAssignableCustomerTagIds } from "../persistence/tags";
import { createCustomerError } from "./errors";

export type {
  CustomerFilters,
  CustomerWriteInput,
} from "../persistence/profiles";

type CreateCustomerInput = CustomerWriteInput & {
  companyName: string;
  departmentId?: string;
};

async function readCustomer(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  includeArchived = false
) {
  const record = await findCustomerProfile(tx, access, id, includeArchived);
  if (!record) throw createCustomerError("profileNotFound");
  return record;
}

async function requireAssignableTags(
  tx: DatabaseTransaction,
  departmentId: string,
  tagIds?: string[]
) {
  if (!tagIds?.length) return;
  const tags = await selectAssignableCustomerTagIds(tx, departmentId, tagIds);
  if (tags.length !== tagIds.length) {
    throw new ApplicationError(400, "所选标签不存在或不属于该客户所在部门。");
  }
}

function translateWriteError(error: unknown): never {
  if (
    isConstraintError(error, "23505", "customer_department_active_name_unique")
  ) {
    throw createCustomerError("profileNameExists");
  }
  if (
    isConstraintError(
      error,
      "23503",
      "customer_channel_assignment_channel_code_fk"
    )
  ) {
    throw new ApplicationError(400, "所选渠道不存在。");
  }
  if (
    isConstraintError(
      error,
      "23503",
      "customer_tag_assignment_tag_id_customer_tag_id_fk"
    )
  ) {
    throw new ApplicationError(400, "所选标签不存在。");
  }
  throw error;
}

export function createProfileUseCases(db: Database) {
  return {
    listCustomers: (access: AccountRecordAccess, filters: CustomerFilters) =>
      withRecordReadSnapshot(
        access.userId,
        (tx, currentAccess) => selectCustomerPage(tx, currentAccess, filters),
        db
      ),

    getCustomer: (access: AccountRecordAccess, id: string) =>
      withRecordReadSnapshot(
        access.userId,
        (tx, currentAccess) => readCustomer(tx, currentAccess, id),
        db
      ),

    async createCustomer(
      access: AccountRecordAccess,
      input: CreateCustomerInput,
      requestId?: string
    ) {
      if (input.departmentId !== undefined && access.scope !== "company") {
        throw createCustomerError("profileDepartmentForbidden");
      }
      const departmentId =
        access.scope === "company" ? input.departmentId : access.departmentId;
      if (departmentId === undefined) {
        throw new ApplicationError(400, "请选择客户所属部门。");
      }
      if (access.scope === "company" && input.ownerUserId === undefined) {
        throw new ApplicationError(400, "请选择业务员。");
      }

      const requestHash = requestId
        ? createHash("sha256")
            .update(
              JSON.stringify({
                companyName: input.companyName,
                departmentId: input.departmentId,
                ownerUserId: input.ownerUserId,
                remark: input.remark ?? null,
                channelCodes: input.channelCodes?.toSorted() ?? [],
                tagIds: input.tagIds?.toSorted() ?? [],
              })
            )
            .digest("hex")
        : undefined;

      for (let attempt = 1; ; attempt++) {
        try {
          return await db.transaction(async (tx) => {
            if (requestId) {
              const existing = await lockCustomerCreateRequest(
                tx,
                access.userId,
                requestId
              );
              if (existing) {
                const { access: freshAccess } = await lockCustomerForWrite(
                  tx,
                  access,
                  existing.id,
                  "share"
                );
                if (existing.hash !== requestHash) {
                  throw new ApplicationError(
                    409,
                    "该提交 ID 已用于不同的客户资料。",
                    { code: "idempotency_conflict" }
                  );
                }
                return readCustomer(tx, freshAccess, existing.id);
              }
            }

            await lockDepartment(tx, departmentId, "share");
            const freshAccess = await readAccountRecordAccess(
              tx,
              access.userId
            );
            if (input.departmentId !== undefined) {
              if (freshAccess.scope !== "company") {
                throw createCustomerError("profileDepartmentForbidden");
              }
            } else if (
              freshAccess.scope === "company" ||
              freshAccess.departmentId !== departmentId
            ) {
              throw new ApplicationError(403, "只能在当前所属部门新建客户。");
            }
            if (
              input.ownerUserId !== undefined &&
              freshAccess.scope === "own"
            ) {
              throw new ApplicationError(
                403,
                "只有部门主管或公司管理员可在新建时指定业务员。"
              );
            }
            const ownerUserId = input.ownerUserId ?? freshAccess.userId;
            await requireAssignableOwner(tx, departmentId, ownerUserId);
            await requireAssignableTags(tx, departmentId, input.tagIds);

            const id = await insertCustomerProfile(
              tx,
              {
                departmentId,
                ownerUserId,
                companyName: input.companyName,
                remark: input.remark,
                creationActorUserId: requestId ? access.userId : undefined,
                creationRequestId: requestId,
                creationRequestHash: requestHash,
              },
              input
            );
            return readCustomer(tx, freshAccess, id);
          });
        } catch (error) {
          if (
            !isConstraintError(error, "23505", "customer_customer_no_unique")
          ) {
            translateWriteError(error);
          }
          if (attempt === 5) {
            throw new ApplicationError(409, "客户编号生成冲突，请重试。");
          }
        }
      }
    },

    async updateCustomer(
      access: AccountRecordAccess,
      id: string,
      input: CustomerWriteInput,
      expectedVersion: number
    ) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await db.transaction(async (tx) => {
            const { access: freshAccess, record } = await lockCustomerForWrite(
              tx,
              access,
              id
            );
            if (
              input.ownerUserId !== undefined &&
              freshAccess.scope === "own"
            ) {
              throw new ApplicationError(
                403,
                "只有部门主管或公司管理员可更换业务员。"
              );
            }
            // 持有客户行锁时比较版本，避免通过检查后被并发修改。
            if (record.version !== expectedVersion) {
              failVersionConflict(await readCustomer(tx, freshAccess, id));
            }
            if (input.ownerUserId !== undefined) {
              await requireAssignableOwner(
                tx,
                record.departmentId,
                input.ownerUserId
              );
            }
            if (
              input.companyName !== undefined &&
              input.companyName !== record.companyName &&
              (await hasActiveCustomerNameConflict(
                tx,
                record.departmentId,
                input.companyName,
                id
              ))
            ) {
              throw createCustomerError("profileNameExists");
            }

            await requireAssignableTags(tx, record.departmentId, input.tagIds);
            await updateCustomerProfile(tx, freshAccess, id, input);
            return readCustomer(tx, freshAccess, id);
          });
        } catch (error) {
          const cause = error instanceof Error ? (error.cause ?? error) : error;
          if (
            typeof cause !== "object" ||
            cause === null ||
            !("code" in cause) ||
            cause.code !== "40P01"
          ) {
            translateWriteError(error);
          }
          if (attempt === 3) {
            throw new ApplicationError(409, "客户资料有并发更新，请重试。");
          }
        }
      }
    },

    archiveCustomer(
      access: AccountRecordAccess,
      id: string,
      expectedVersion: number
    ) {
      return db.transaction(async (tx) => {
        const { access: freshAccess, record } = await lockCustomerForWrite(
          tx,
          access,
          id,
          "no key update",
          true
        );
        if (record.status === "archived") {
          if (record.version !== expectedVersion + 1) {
            throw createCustomerError("profileNotFound");
          }
          return readCustomer(tx, freshAccess, id, true);
        }
        if (record.version !== expectedVersion) {
          failVersionConflict(await readCustomer(tx, freshAccess, id));
        }

        // 加锁后检查产品，关联写入也要先取得同一客户锁。
        if (await hasActiveCustomerProduct(tx, id)) {
          throw new ApplicationError(
            409,
            "该客户还有未归档产品，请先归档产品。"
          );
        }
        await archiveCustomerProfile(tx, id, freshAccess.userId, new Date());
        return readCustomer(tx, freshAccess, id, true);
      });
    },
  };
}
