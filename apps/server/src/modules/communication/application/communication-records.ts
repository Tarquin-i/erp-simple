import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";
import { HTTPException } from "hono/http-exception";

import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { lockCustomerForWrite, requireAssignableOwner } from "../../customer";
import {
  closeCommunicationUploads,
  readCommunicationAttachmentsToClean,
} from "../persistence/attachments";
import {
  insertCommunication,
  markCommunicationArchived,
  lockCommunicationCreateRequest,
  lockCommunicationForWrite,
  lockCreatedCommunication,
  readCommunication,
  selectCommunicationOwners,
  selectCommunicationPage,
  startCommunicationArchive,
  updateCommunicationRecord,
} from "../persistence/communication-records";
import type {
  CommunicationFilters,
  CreateCommunicationInput,
  UpdateCommunicationInput,
} from "../persistence/communication-records";
import { selectAssignableCommunicationTagIds } from "../persistence/tags";
import type { AttachmentCleanup } from "./attachment-cleanup";
import {
  CommunicationArchiveInProgress,
  createCommunicationConflict,
  createCommunicationError,
} from "./errors";

/**
 * 校验新增记录或变更负责人后的目标范围。具体模块仍需校验负责人资格。
 * @param access 当前账号的业务范围。
 * @param target 目标部门和负责人，未指定负责人时传 `null`。
 * @returns 校验通过时无返回值。
 * @throws 目标超出当前账号的数据范围时抛出 writeTargetForbidden。
 */
function assertCommunicationWriteTarget(
  access: AccountRecordAccess,
  target: { departmentId: string; ownerUserId: string | null }
) {
  if (access.scope === "company") return;

  if (
    target.departmentId !== access.departmentId ||
    (access.scope === "own" && target.ownerUserId !== access.userId)
  ) {
    throw createCommunicationError("writeTargetForbidden");
  }
}

async function requireAssignableTags(
  tx: DatabaseTransaction,
  departmentId: string,
  tagIds?: string[]
) {
  if (!tagIds?.length) return;
  const tags = await selectAssignableCommunicationTagIds(
    tx,
    departmentId,
    tagIds
  );
  if (tags.length !== tagIds.length) {
    throw createCommunicationError("tagsNotAssignable");
  }
}

/**
 * 运行完整写入事务，遇到数据库死锁时最多尝试三次。
 * @param db 当前模块使用的数据库实例。
 * @param write 包含权限、版本核对和数据写入的事务回调。
 * @returns 成功提交的事务结果。
 * @throws 标签不存在时抛出 assignedTagNotFound，死锁重试用尽时抛出 recordConcurrentUpdate，其余错误原样抛出。
 */
async function writeCommunication<T>(
  db: Database,
  write: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(write);
    } catch (error) {
      if (
        isConstraintError(
          error,
          "23503",
          "communication_tag_assignment_tag_id_communication_tag_id_fk"
        )
      ) {
        throw createCommunicationError("assignedTagNotFound");
      }
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "40P01"
      ) {
        throw error;
      }
      if (attempt === 3)
        throw createCommunicationError("recordConcurrentUpdate");
    }
  }
}

/**
 * 计算已校验的新建请求指纹，忽略标签顺序及空标签列表的写法差异。
 * @param input 已校验客户、主题、内容、业务员、标签和状态。
 * @returns 十六进制 SHA-256 摘要，用于核对重试时的原始内容。
 */
function fingerprintCreation(input: CreateCommunicationInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        customerId: input.customerId,
        title: input.title,
        summary: input.summary,
        ownerUserId: input.ownerUserId ?? null,
        tagIds: input.tagIds?.toSorted() ?? [],
        // 默认状态沿用旧指纹，允许发布前的提交继续重试。
        status: input.status === "pending" ? undefined : input.status,
      })
    )
    .digest("hex");
}

async function finishCommunicationArchive(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string
) {
  await markCommunicationArchived(tx, id, access.userId);
  return readCommunication(tx, access, id, true);
}

async function lockCommunicationForArchive(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  expectedVersion: number
) {
  const locked = await lockCommunicationForWrite(tx, access, id, true);
  const { freshAccess, record } = locked;
  if (record.archivedAt) {
    if (record.version !== expectedVersion + 1) {
      throw createCommunicationError("recordNotFound");
    }
  } else if (record.version !== expectedVersion) {
    throw createCommunicationError(
      "recordVersionConflict",
      await readCommunication(tx, freshAccess, id)
    );
  }
  return locked;
}

const archiveCleanupBatchSize = 3;

/** 关闭未完成的上传并分批清理。可用同一版本续做或确认归档结果。 */

export function createCommunicationRecordUseCases(
  db: Database,
  cleanup: Pick<
    AttachmentCleanup,
    "cleanupCommunicationAttachments" | "requestAttachmentUploadCleanup"
  >
) {
  return {
    listCommunications(
      access: AccountRecordAccess,
      filters: CommunicationFilters
    ) {
      return withRecordReadSnapshot(
        access.userId,
        (tx, freshAccess) => selectCommunicationPage(tx, freshAccess, filters),
        db
      );
    },
    getCommunication(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        (tx, freshAccess) => readCommunication(tx, freshAccess, id),
        db
      );
    },
    listCommunicationOwners(access: AccountRecordAccess) {
      return withRecordReadSnapshot(
        access.userId,
        selectCommunicationOwners,
        db
      );
    },
    createCommunication(
      access: AccountRecordAccess,
      input: CreateCommunicationInput,
      requestId: string
    ) {
      const requestHash = fingerprintCreation(input);
      return writeCommunication(db, async (tx) => {
        const existing = await lockCommunicationCreateRequest(
          tx,
          access.userId,
          requestId
        );
        if (existing) {
          const { freshAccess, visible } = await lockCreatedCommunication(
            tx,
            access.userId,
            existing
          );
          if (existing.requestHash !== requestHash) {
            throw createCommunicationError("recordIdempotencyConflict");
          }
          return readCommunication(tx, freshAccess, visible.id);
        }

        const { access: freshAccess, record: linkedCustomer } =
          await lockCustomerForWrite(tx, access, input.customerId, "share");
        if (
          freshAccess.scope === "company" &&
          input.ownerUserId === undefined
        ) {
          throw createCommunicationError("recordOwnerRequired");
        }
        const departmentId = linkedCustomer.departmentId;
        const ownerUserId = input.ownerUserId ?? freshAccess.userId;
        assertCommunicationWriteTarget(freshAccess, {
          departmentId,
          ownerUserId,
        });
        await requireAssignableOwner(tx, departmentId, ownerUserId);
        await requireAssignableTags(tx, departmentId, input.tagIds);
        const id = await insertCommunication(
          tx,
          { ...input, customerId: linkedCustomer.id },
          departmentId,
          ownerUserId,
          { userId: freshAccess.userId, id: requestId, hash: requestHash }
        );
        return readCommunication(tx, freshAccess, id);
      });
    },
    updateCommunication(
      access: AccountRecordAccess,
      id: string,
      input: UpdateCommunicationInput,
      expectedVersion: number
    ) {
      return writeCommunication(db, async (tx) => {
        const { freshAccess, record } = await lockCommunicationForWrite(
          tx,
          access,
          id
        );
        if (record.archiveStartedAt) throw new CommunicationArchiveInProgress();
        if (input.ownerUserId !== undefined && freshAccess.scope === "own") {
          throw createCommunicationError("recordOwnerChangeForbidden");
        }
        if (record.version !== expectedVersion) {
          throw createCommunicationError(
            "recordVersionConflict",
            await readCommunication(tx, freshAccess, id)
          );
        }
        if (input.ownerUserId !== undefined) {
          await requireAssignableOwner(
            tx,
            record.departmentId,
            input.ownerUserId
          );
        }

        await requireAssignableTags(tx, record.departmentId, input.tagIds);
        await updateCommunicationRecord(tx, id, input);
        return readCommunication(tx, freshAccess, id);
      });
    },
    async archiveCommunication(
      access: AccountRecordAccess,
      id: string,
      expectedVersion: number
    ) {
      const started = await writeCommunication(db, async (tx) => {
        const { freshAccess, record } = await lockCommunicationForArchive(
          tx,
          access,
          id,
          expectedVersion
        );
        if (record.archivedAt) {
          return {
            communication: await readCommunication(tx, freshAccess, id, true),
          };
        }
        if (!record.archiveStartedAt) {
          const startedAt = new Date();
          await startCommunicationArchive(tx, id, startedAt);
          await closeCommunicationUploads(
            tx,
            id,
            freshAccess.userId,
            startedAt
          );
        }
        const attachments = await readCommunicationAttachmentsToClean(
          tx,
          id,
          archiveCleanupBatchSize
        );
        return attachments.length
          ? { attachments }
          : {
              communication: await finishCommunicationArchive(
                tx,
                freshAccess,
                id
              ),
            };
      });
      if (!started.attachments) return started.communication;

      let cleanupError: HTTPException | undefined;
      try {
        await cleanup.cleanupCommunicationAttachments(started.attachments);
      } catch (error) {
        if (!(error instanceof HTTPException) || error.status !== 503)
          throw error;
        // 另一个归档请求可能已经清理成功，仍按当前权限和版本核对结果。
        cleanupError = error;
      }
      const archived = await writeCommunication(db, async (tx) => {
        const { freshAccess, record } = await lockCommunicationForArchive(
          tx,
          access,
          id,
          expectedVersion
        );
        if (record.archivedAt) {
          return readCommunication(tx, freshAccess, id, true);
        }
        if ((await readCommunicationAttachmentsToClean(tx, id, 1)).length)
          return;
        return finishCommunicationArchive(tx, freshAccess, id);
      });
      if (archived) return archived;

      cleanup.requestAttachmentUploadCleanup();
      if (cleanupError) throw cleanupError;
      throw createCommunicationConflict("archive_cleanup_pending");
    },
  };
}
