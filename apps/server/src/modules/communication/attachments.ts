import { communication, communicationAttachment, user } from "@repo/db/schema";
import { and, count, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  businessScopeWhere,
  readBusinessAccess,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import { isConstraintError } from "../customer/input";
import { database } from "../identity/auth/better-auth";
import type { DatabaseTransaction } from "../identity/auth/better-auth";
import { lockDepartment } from "../organization/departments";
import { fail } from "../organization/errors";
import { verifyAttachmentContent } from "./attachment-files";
import type { AttachmentUploadInput } from "./attachment-files";
import type { AttachmentStorage } from "./attachment-storage";

type Attachment = typeof communicationAttachment.$inferSelect;
type GetStorage = () => AttachmentStorage;

const activeHashConstraint = "communication_attachment_active_sha256_unique";
const visibleAttachment = and(
  isNull(communicationAttachment.objectDeletedAt),
  or(
    eq(communicationAttachment.uploadState, "ready"),
    isNotNull(communicationAttachment.archivedAt)
  )
);
const attachmentMetadata = {
  id: communicationAttachment.id,
  fileName: communicationAttachment.fileName,
  fileSize: communicationAttachment.fileSize,
  mimeType: communicationAttachment.mimeType,
  uploaderUserId: communicationAttachment.uploaderUserId,
  uploaderName: user.name,
  uploadedAt: communicationAttachment.uploadedAt,
  deletionPending: sql<boolean>`${communicationAttachment.archivedAt} is not null`,
};

function attachmentError(
  status: 409 | 503,
  code: string,
  message: string
): never {
  throw new HTTPException(status, {
    res: Response.json({ code, message }, { status }),
  });
}

function duplicateAttachment(): never {
  return attachmentError(
    409,
    "attachment_duplicate",
    "这条沟通已包含相同内容的附件。"
  );
}

function storageUnavailable(): never {
  return attachmentError(
    503,
    "attachment_storage_unavailable",
    "附件存储暂不可用，请稍后重试。"
  );
}

/**
 * 将 OSS 及流读取失败转换成可重试错误，保留业务校验响应。
 * @param run 一次读取、签名或清理操作。
 * @returns 操作的结果。
 * @throws 业务错误原样返回，存储错误返回 503。
 */
async function useStorage<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return storageUnavailable();
  }
}

async function requireCommunication(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  communicationId: string,
  lockedDepartmentId?: string
) {
  const query = tx
    .select({ departmentId: communication.departmentId })
    .from(communication)
    .where(
      and(
        eq(communication.id, communicationId),
        businessScopeWhere(access, communication),
        lockedDepartmentId === undefined
          ? undefined
          : eq(communication.departmentId, lockedDepartmentId)
      )
    );
  const [record] = await (lockedDepartmentId === undefined
    ? query
    : query.for("share"));
  if (!record) fail(404, "沟通记录不存在。");
  return record;
}

/**
 * 在短事务中按部门、沟通记录、附件的顺序加锁，改派后以当前权限为准。
 * @param access 当前账号及其业务范围。
 * @param communicationId 附件归属的沟通 ID。
 * @param write 只执行数据库工作，OSS 传输在事务外进行。
 * @returns 写入或读取结果。
 */
function withAttachmentWrite<T>(
  access: BusinessAccess,
  communicationId: string,
  write: (tx: DatabaseTransaction) => Promise<T>
) {
  return database.db.transaction(async (tx) => {
    const { departmentId } = await requireCommunication(
      tx,
      access,
      communicationId
    );
    await lockDepartment(tx, departmentId, "share");
    const current = await readBusinessAccess(tx, access.userId);
    await requireCommunication(tx, current, communicationId, departmentId);
    return write(tx);
  });
}

function attachmentForCommunication(
  communicationId: string,
  attachmentId: string
) {
  return and(
    eq(communicationAttachment.communicationId, communicationId),
    eq(communicationAttachment.id, attachmentId)
  );
}

function uploadForCommunication(
  communicationId: string,
  uploadClientId: string
) {
  return and(
    eq(communicationAttachment.communicationId, communicationId),
    eq(communicationAttachment.uploadClientId, uploadClientId)
  );
}

async function publicAttachment(tx: DatabaseTransaction, attachmentId: string) {
  const [row] = await tx
    .select(attachmentMetadata)
    .from(communicationAttachment)
    .innerJoin(user, eq(user.id, communicationAttachment.uploaderUserId))
    .where(eq(communicationAttachment.id, attachmentId));
  return row;
}

/**
 * 查询可用和待清理附件。正在上传的记录不会进入普通列表。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param page 页码与页大小。
 * @returns 一页附件及总数。
 * @throws 无权查看沟通时返回 404。
 */
export function listCommunicationAttachments(
  access: BusinessAccess,
  communicationId: string,
  { page, pageSize }: { page: number; pageSize: number }
) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    await requireCommunication(tx, freshAccess, communicationId);
    const where = and(
      eq(communicationAttachment.communicationId, communicationId),
      visibleAttachment
    );
    const [attachments, [total]] = await Promise.all([
      tx
        .select(attachmentMetadata)
        .from(communicationAttachment)
        .innerJoin(user, eq(user.id, communicationAttachment.uploaderUserId))
        .where(where)
        .orderBy(
          desc(communicationAttachment.uploadedAt),
          desc(communicationAttachment.id)
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ value: count() }).from(communicationAttachment).where(where),
    ]);
    return { attachments, total: total?.value ?? 0, page, pageSize };
  });
}

function assertSameUpload(
  row: Attachment,
  access: BusinessAccess,
  file: AttachmentUploadInput
) {
  if (
    row.uploaderUserId !== access.userId ||
    row.fileName !== file.fileName ||
    row.fileSize !== file.fileSize ||
    row.mimeType !== file.mimeType ||
    row.expectedContentSha256 !== file.expectedContentSha256
  ) {
    attachmentError(
      409,
      "attachment_upload_conflict",
      "该上传 ID 已被使用，请重新选择文件。"
    );
  }
  if (row.archivedAt) {
    attachmentError(
      409,
      "attachment_upload_closed",
      "该上传已关闭，请重新选择文件。"
    );
  }
}

/**
 * 创建或重用上传会话。签名只允许客户端写暂存对象。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param file 已校验的文件元数据和上传 ID。
 * @param getStorage 按需读取存储配置。
 * @returns 上传会话。OSS 已收到对象时，upload 为 null，可继续完成校验。
 * @throws 无权访问、重复文件或同一上传 ID 对应的内容不同。
 */
export async function initCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  file: AttachmentUploadInput,
  getStorage: GetStorage
) {
  const { row, existing, storage } = await withAttachmentWrite(
    access,
    communicationId,
    async (tx) => {
      const read = () =>
        tx
          .select()
          .from(communicationAttachment)
          .where(uploadForCommunication(communicationId, file.uploadClientId));
      const [previous] = await read();
      if (previous) {
        assertSameUpload(previous, access, file);
        return {
          row: previous,
          existing: true,
          storage:
            previous.uploadState === "ready"
              ? null
              : await useStorage(getStorage),
        };
      }

      const [duplicate] = await tx
        .select({ id: communicationAttachment.id })
        .from(communicationAttachment)
        .where(
          and(
            eq(communicationAttachment.communicationId, communicationId),
            eq(
              communicationAttachment.contentSha256,
              file.expectedContentSha256
            ),
            eq(communicationAttachment.uploadState, "ready"),
            isNull(communicationAttachment.archivedAt)
          )
        );
      if (duplicate) duplicateAttachment();
      const storage = await useStorage(getStorage);
      const [created] = await tx
        .insert(communicationAttachment)
        .values({
          ...file,
          communicationId,
          uploaderUserId: access.userId,
          storageKey: `${file.uploadClientId.slice(0, 2)}/${communicationId}/${file.uploadClientId}`,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return { row: created, existing: false, storage };

      // 同一上传 ID 同时命中会话和对象键的唯一索引，读取先写入的会话。
      const [winner] = await read();
      if (!winner) fail(409, "上传会话已变化，请重试。");
      assertSameUpload(winner, access, file);
      return { row: winner, existing: true, storage };
    }
  );
  const upload =
    storage && row.uploadState !== "ready"
      ? await useStorage(async () => {
          if (
            existing &&
            ((await storage.readSingleUploadMetadata(row.storageKey)) ??
              (await storage.readMetadata(row.storageKey)))
          ) {
            return null;
          }
          return storage.createSingleUploadRequest(
            row.storageKey,
            row.fileSize,
            row.mimeType
          );
        })
      : null;
  return {
    attachmentId: row.id,
    mode: "single" as const,
    uploadClientId: row.uploadClientId,
    upload,
  };
}

async function readUpload(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string
) {
  const [row] = await tx
    .select()
    .from(communicationAttachment)
    .where(
      and(
        uploadForCommunication(communicationId, uploadClientId),
        eq(communicationAttachment.uploaderUserId, access.userId)
      )
    )
    .for("update");
  if (!row) fail(404, "附件上传不存在。");
  return row;
}

async function inspectUpload(row: Attachment, storage: AttachmentStorage) {
  return useStorage(async () => {
    let metadata = await storage.readMetadata(row.storageKey);
    if (!metadata) {
      const staged = await storage.readSingleUploadMetadata(row.storageKey);
      if (staged) {
        if (staged.contentLength !== row.fileSize)
          fail(400, "附件实际大小与声明不一致。");
        try {
          await storage.promoteSingleUpload(row.storageKey);
        } catch (error) {
          // 重试、并发完成或响应丢失时，正式对象可能已经成功创建。
          metadata = await storage.readMetadata(row.storageKey);
          if (!metadata) throw error;
        }
      } else {
        metadata = await storage.readMetadata(row.storageKey);
        if (!metadata)
          attachmentError(
            409,
            "attachment_upload_incomplete",
            "尚未收到附件，请先完成上传。"
          );
      }
    }
    const content = await storage.openReadStream(row.storageKey);
    if (!content) return storageUnavailable();
    if (
      content.contentLength !== null &&
      content.contentLength !== row.fileSize
    ) {
      await content.body.cancel().catch(() => {});
      fail(400, "附件实际大小与声明不一致。");
    }
    return verifyAttachmentContent(row, content.body);
  });
}

async function cleanupArchived(row: Attachment, storage: AttachmentStorage) {
  try {
    await useStorage(async () => {
      try {
        await storage.removeSingleUpload(row.storageKey);
      } finally {
        await storage.remove(row.storageKey);
      }
    });
  } catch (error) {
    // 完成请求可能在并发删除后才拿到结果。若补偿清理失败，让该条重新可重试。
    await database.db
      .update(communicationAttachment)
      .set({ objectDeletedAt: null })
      .where(
        and(
          eq(communicationAttachment.id, row.id),
          isNotNull(communicationAttachment.archivedAt)
        )
      );
    throw error;
  }
  await database.db
    .update(communicationAttachment)
    .set({
      objectDeletedAt: sql`greatest(now(), ${communicationAttachment.archivedAt})`,
    })
    .where(
      and(
        eq(communicationAttachment.id, row.id),
        isNotNull(communicationAttachment.archivedAt),
        isNull(communicationAttachment.objectDeletedAt)
      )
    );
}

async function archivePendingUpload(access: BusinessAccess, row: Attachment) {
  return withAttachmentWrite(access, row.communicationId, async (tx) => {
    const [archived] = await tx
      .update(communicationAttachment)
      .set({ archivedAt: sql`now()`, archivedByUserId: access.userId })
      .where(
        and(
          eq(communicationAttachment.id, row.id),
          eq(communicationAttachment.uploaderUserId, access.userId),
          eq(communicationAttachment.uploadState, "pending"),
          isNull(communicationAttachment.archivedAt)
        )
      )
      .returning();
    return archived;
  });
}

/**
 * 校验正式对象，再用短事务重新检查权限及状态后发布附件。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param uploadClientId 初始化时获取的上传 ID。
 * @param getStorage 按需读取存储配置。
 * @returns 可展示的附件元数据。重复完成请求返回同一条记录。
 * @throws 内容无效、重复文件、权限变化或存储未就绪时返回业务错误。
 */
export async function completeCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string,
  getStorage: GetStorage
) {
  const start = await withAttachmentWrite(
    access,
    communicationId,
    async (tx) => {
      const row = await readUpload(tx, access, communicationId, uploadClientId);
      if (row.archivedAt) fail(404, "附件上传已关闭。");
      return row.uploadState === "ready"
        ? { ready: await publicAttachment(tx, row.id), row: null }
        : { row, ready: null };
    }
  );
  if (!start.row) return start.ready;

  const row = start.row;
  const storage = await useStorage(getStorage);
  try {
    const verifiedHash = await inspectUpload(row, storage);
    const result = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const current = await readUpload(
          tx,
          access,
          communicationId,
          uploadClientId
        );
        if (current.archivedAt) fail(404, "附件上传已关闭。");
        if (current.uploadState === "pending") {
          await tx
            .update(communicationAttachment)
            .set({
              uploadState: "ready",
              contentSha256: verifiedHash,
              uploadedAt: sql`now()`,
            })
            .where(eq(communicationAttachment.id, current.id));
        }
        return publicAttachment(tx, current.id);
      }
    );
    // 只供上传使用的暂存对象可以独立回收，清理失败不撤销已发布的附件。
    await storage.removeSingleUpload(row.storageKey).catch(() => {});
    return result;
  } catch (error) {
    const duplicate = isConstraintError(error, "23505", activeHashConstraint);
    const invalid = error instanceof HTTPException && error.status === 400;
    if (duplicate || invalid) {
      await archivePendingUpload(access, row).catch(() => {});
    }
    // 兼顾完成与删除重叠，出现晚到的正式对象时再补偿清理一次。
    const [archived] = await database.db
      .select()
      .from(communicationAttachment)
      .where(
        and(
          eq(communicationAttachment.id, row.id),
          isNotNull(communicationAttachment.archivedAt)
        )
      );
    if (archived) await cleanupArchived(archived, storage).catch(() => {});
    if (duplicate) duplicateAttachment();
    throw error;
  }
}

/** 校验当前沟通权限和附件状态后，签发带原文件名的短期下载地址。 */
export function downloadCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string,
  getStorage: GetStorage
) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    await requireCommunication(tx, freshAccess, communicationId);
    const [row] = await tx
      .select({
        storageKey: communicationAttachment.storageKey,
        fileName: communicationAttachment.fileName,
      })
      .from(communicationAttachment)
      .where(
        and(
          attachmentForCommunication(communicationId, attachmentId),
          eq(communicationAttachment.uploadState, "ready"),
          isNull(communicationAttachment.archivedAt)
        )
      );
    if (!row) fail(404, "附件不存在或不可下载。");
    return useStorage(() =>
      getStorage().createDownloadUrl(row.storageKey, row.fileName)
    );
  });
}

/**
 * 先归档阻止新下载，再删除 OSS 对象。失败时保留可重试的归档记录。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param attachmentId 附件 ID。
 * @param getStorage 按需读取存储配置。
 * @returns 删除完成或已完成时正常结束。
 */
export async function deleteCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string,
  getStorage: GetStorage
) {
  const row = await withAttachmentWrite(access, communicationId, async (tx) => {
    const [current] = await tx
      .select()
      .from(communicationAttachment)
      .where(attachmentForCommunication(communicationId, attachmentId))
      .for("update");
    if (!current) fail(404, "附件不存在。");
    if (current.objectDeletedAt) return null;
    if (current.archivedAt) return current;
    const [archived] = await tx
      .update(communicationAttachment)
      .set({ archivedAt: sql`now()`, archivedByUserId: access.userId })
      .where(eq(communicationAttachment.id, attachmentId))
      .returning();
    return archived;
  });
  if (row) await cleanupArchived(row, await useStorage(getStorage));
}
