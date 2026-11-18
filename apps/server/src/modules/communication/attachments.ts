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
import { attachmentImageResponse } from "./attachment-images";
import { LocalAttachmentSizeError } from "./attachment-local-storage";
import { attachmentDownloadDisposition } from "./attachment-oss-signing";
import type { AttachmentStorage } from "./attachment-storage";

type Attachment = typeof communicationAttachment.$inferSelect;
type GetStorage = () => AttachmentStorage;

const activeHashConstraint = "communication_attachment_active_sha256_unique";
// 本地单次上传受 Bun HTTP 请求体默认上限约束。
const maxLocalUploadBytes = 128 * 1024 ** 2;
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
 * 将存储及流读取失败转换成可重试错误，保留业务校验响应。
 * @param run 一次读取、签名或清理操作。
 * @returns 操作的结果。
 * @throws 业务错误原样返回，存储错误返回 503。
 */
async function useStorage<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof LocalAttachmentSizeError) {
      fail(400, "附件实际大小与声明不一致。");
    }
    return storageUnavailable();
  }
}

function attachmentPath(communicationId: string) {
  return `/api/communications/${communicationId}/attachments`;
}

function requireLocalStorage(getStorage: GetStorage) {
  const storage = getStorage();
  if (storage.kind !== "local") fail(404, "本地附件存储未启用。");
  return storage;
}

async function uploadStorage(getStorage: GetStorage, fileSize: number) {
  const storage = await useStorage(getStorage);
  if (storage.kind === "local" && fileSize > maxLocalUploadBytes) {
    fail(400, "本地存储的单个附件不能超过 128 MiB。");
  }
  return storage;
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
 * @param write 只执行数据库工作，文件传输在事务外进行。
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

function uploadForUploader(
  communicationId: string,
  uploadClientId: string,
  uploaderUserId: string
) {
  return and(
    uploadForCommunication(communicationId, uploadClientId),
    eq(communicationAttachment.uploaderUserId, uploaderUserId)
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
 * @returns 上传会话。存储已收到文件时，upload 为 null，可继续完成校验。
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
              : await uploadStorage(getStorage, previous.fileSize),
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
      const storage = await uploadStorage(getStorage, file.fileSize);
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
          if (storage.kind === "local") {
            return {
              url: `${attachmentPath(communicationId)}/uploads/${row.uploadClientId}/content`,
              headers: { "content-type": row.mimeType },
              expiresAt: null,
            };
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

async function lockUpload(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string
) {
  const [row] = await tx
    .select()
    .from(communicationAttachment)
    .where(uploadForUploader(communicationId, uploadClientId, access.userId))
    .for("update");
  return row;
}

async function readUpload(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string
) {
  const row = await lockUpload(tx, access, communicationId, uploadClientId);
  if (!row) fail(404, "附件上传不存在。");
  return row;
}

/**
 * 查询原上传人在当前沟通下的上传会话状态，无需访问附件存储。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param uploadClientId 初始化时使用的上传 ID。
 * @returns 未完成、已发布或无可用会话。已归档的会话视为不可用。
 * @throws 无权查看沟通时返回 404。
 */
export function getCommunicationAttachmentUpload(
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string
) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    await requireCommunication(tx, freshAccess, communicationId);
    const [row] = await tx
      .select({
        uploadState: communicationAttachment.uploadState,
        archivedAt: communicationAttachment.archivedAt,
      })
      .from(communicationAttachment)
      .where(uploadForUploader(communicationId, uploadClientId, access.userId));
    return {
      state: row && !row.archivedAt ? row.uploadState : ("missing" as const),
    };
  });
}

/** 按当前沟通权限和原上传人校验，将请求体流式写入本地暂存区。 */
export async function writeLocalCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string,
  request: Request,
  getStorage: GetStorage
) {
  const row = await withAttachmentWrite(access, communicationId, async (tx) => {
    const upload = await readUpload(
      tx,
      access,
      communicationId,
      uploadClientId
    );
    if (upload.archivedAt) fail(404, "附件上传已关闭。");
    return upload;
  });
  const storage = await useStorage(() => requireLocalStorage(getStorage));
  if (row.uploadState === "ready") fail(409, "附件已收到，请完成校验。");
  if (row.fileSize > maxLocalUploadBytes)
    fail(400, "本地存储的单个附件不能超过 128 MiB。");
  if (request.headers.get("content-type") !== row.mimeType) {
    fail(415, "附件类型与初始化时声明的类型不一致。");
  }
  const length = request.headers.get("content-length");
  if (length !== null && length !== String(row.fileSize)) {
    fail(400, "附件实际大小与声明不一致。");
  }
  const result = await useStorage(() =>
    storage.writeSingleUpload(
      row.storageKey,
      row.fileSize,
      request.body ?? new Blob().stream(),
      request.signal
    )
  );
  if (result === "exists") fail(409, "附件已收到，请完成校验。");

  try {
    await withAttachmentWrite(access, communicationId, async (tx) => {
      const current = await readUpload(
        tx,
        access,
        communicationId,
        uploadClientId
      );
      if (current.archivedAt) fail(404, "附件上传已关闭。");
    });
  } catch (error) {
    // 写文件期间可能发生改派或删除，回收已不可完成的这次上传。
    if (isUploadInaccessible(error)) {
      await cleanupPendingLocalUpload(row, storage).catch(() => {});
    }
    throw error;
  }
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

/**
 * 取消原上传人的未完成会话。先归档，再清理暂存和正式对象。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param uploadClientId 初始化时使用的上传 ID。
 * @param getStorage 按需读取存储配置。
 * @returns `ready` 表示附件已发布并予以保留，`missing` 表示会话不存在或已清理。
 * @throws 无权访问沟通时返回 404，文件清理失败时返回 503，可用同一上传 ID 重试。
 */
export async function cancelCommunicationAttachmentUpload(
  access: BusinessAccess,
  communicationId: string,
  uploadClientId: string,
  getStorage: GetStorage
) {
  const { state, row } = await withAttachmentWrite(
    access,
    communicationId,
    async (tx) => {
      const current = await lockUpload(
        tx,
        access,
        communicationId,
        uploadClientId
      );
      if (!current || current.objectDeletedAt) {
        return { state: "missing" as const, row: null };
      }
      // 与完成请求竞争同一行锁。附件已发布时，不能通过取消上传删掉它。
      if (current.uploadState === "ready") {
        return {
          state: current.archivedAt ? ("missing" as const) : ("ready" as const),
          row: null,
        };
      }
      if (current.archivedAt)
        return { state: "missing" as const, row: current };
      const [archived] = await tx
        .update(communicationAttachment)
        .set({ archivedAt: sql`now()`, archivedByUserId: access.userId })
        .where(eq(communicationAttachment.id, current.id))
        .returning();
      return { state: "missing" as const, row: archived };
    }
  );
  if (row) await cleanupArchived(row, await useStorage(getStorage));
  return { state };
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

function isUploadInaccessible(error: unknown) {
  return (
    error instanceof HTTPException && [401, 403, 404].includes(error.status)
  );
}

async function cleanupArchivedUpload(
  row: Attachment,
  storage: AttachmentStorage
) {
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
}

/** 回收权限变化前已接收的文件，只归档仍未完成的上传。 */
async function cleanupPendingLocalUpload(
  row: Attachment,
  storage: AttachmentStorage
) {
  await database.db
    .update(communicationAttachment)
    .set({ archivedAt: sql`now()`, archivedByUserId: row.uploaderUserId })
    .where(
      and(
        eq(communicationAttachment.id, row.id),
        eq(communicationAttachment.uploadState, "pending"),
        isNull(communicationAttachment.archivedAt)
      )
    );
  await cleanupArchivedUpload(row, storage);
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
    if (storage.kind === "local" && isUploadInaccessible(error)) {
      await cleanupPendingLocalUpload(row, storage).catch(() => {});
    } else {
      if (duplicate || invalid) {
        await archivePendingUpload(access, row).catch(() => {});
      }
      // 完成与删除重叠时，补偿清理晚到的正式文件。
      await cleanupArchivedUpload(row, storage).catch(() => {});
    }
    if (duplicate) duplicateAttachment();
    throw error;
  }
}

function readDownloadableAttachment(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string
) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    await requireCommunication(tx, freshAccess, communicationId);
    const [row] = await tx
      .select({
        storageKey: communicationAttachment.storageKey,
        fileName: communicationAttachment.fileName,
        fileSize: communicationAttachment.fileSize,
        mimeType: communicationAttachment.mimeType,
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
    return row;
  });
}

/** 校验当前沟通权限和附件状态后，返回当前存储模式的下载地址。 */
export async function downloadCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string,
  getStorage: GetStorage
) {
  const row = await readDownloadableAttachment(
    access,
    communicationId,
    attachmentId
  );
  return useStorage(() => {
    const storage = getStorage();
    if (storage.kind === "local") {
      return {
        downloadUrl: `${attachmentPath(communicationId)}/${attachmentId}/content`,
        expiresAt: null,
      };
    }
    return storage.createDownloadUrl(row.storageKey, row.fileName);
  });
}

/** 打开本地正式文件的流。每次请求链路都会重新检查沟通权限。 */
export async function readLocalCommunicationAttachment(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string,
  getStorage: GetStorage
) {
  const row = await readDownloadableAttachment(
    access,
    communicationId,
    attachmentId
  );
  return useStorage(async () => {
    const storage = requireLocalStorage(getStorage);
    const file = await storage.openReadStream(row.storageKey);
    if (!file) fail(404, "附件文件不存在。");

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": attachmentDownloadDisposition(row.fileName),
      "Content-Type": row.mimeType,
      "X-Content-Type-Options": "nosniff",
    });
    if (file.contentLength !== null) {
      headers.set("Content-Length", String(file.contentLength));
    }
    return new Response(file.body, { headers });
  });
}

/**
 * 按当前沟通权限读取已发布且未归档的原图或缩略图。
 * @param access 当前账号。
 * @param communicationId 所属沟通 ID。
 * @param attachmentId 附件 ID。
 * @param variant 要读取的图片版本。
 * @param getStorage 按需读取存储配置。
 * @param signal 请求取消信号。
 * @returns 图片响应，原图保持原始文件字节。
 * @throws 无权查看及附件不可用时返回 404，非图片返回 415，存储失败时返回 503。
 */
export async function readCommunicationAttachmentImage(
  access: BusinessAccess,
  communicationId: string,
  attachmentId: string,
  variant: "thumbnail" | "preview",
  getStorage: GetStorage,
  signal: AbortSignal
) {
  const file = await readDownloadableAttachment(
    access,
    communicationId,
    attachmentId
  );
  return useStorage(() =>
    attachmentImageResponse(
      file,
      variant,
      () => getStorage().openReadStream(file.storageKey),
      signal
    )
  );
}

/**
 * 先归档阻止新下载，再删除存储文件。失败时保留可重试的归档记录。
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
