import { HTTPException } from "hono/http-exception";

import {
  readBusinessAccess,
  withBusinessReadSnapshot,
} from "../../business/access";
import type { BusinessAccess } from "../../business/access";
import type {
  Database,
  DatabaseTransaction,
} from "../../identity/auth/better-auth";
import { lockDepartment } from "../../organization";
import { fail } from "../../../errors";
import type { AttachmentUploadInput } from "../domain/attachment-files";
import {
  archiveAttachment,
  archiveOwnedPendingAttachment,
  findAttachmentUpload,
  hasPublishedAttachmentWithHash,
  insertAttachmentUpload,
  isDuplicateAttachmentError,
  lockAttachment,
  lockAttachmentUpload,
  publishAttachment,
  readAttachmentDeletion,
  readAttachmentUploadState,
  readPublishedAttachment,
  readDownloadableAttachment as selectDownloadableAttachment,
  requireCommunication,
  selectAttachmentPage,
} from "../persistence/attachments";
import type {
  Attachment,
  AttachmentPagination,
} from "../persistence/attachments";
import { verifyAttachmentContent } from "../storage/file-content";
import { attachmentImageResponse } from "../storage/images";
import type {
  AttachmentStorage,
  GetAttachmentStorage,
} from "../storage/object-store";
import { attachmentDownloadDisposition } from "../storage/oss-signing";
import type { AttachmentCleanup } from "./attachment-cleanup";
import {
  CommunicationArchiveInProgress,
  attachmentError,
  duplicateAttachment,
  storageUnavailable,
  useStorage,
} from "./errors";

const maxSingleUploadBytes = 5 * 1024 ** 3;
// 本地单次上传受 Bun HTTP 请求体默认上限约束。
const maxLocalUploadBytes = 128 * 1024 ** 2;

/** 读取可选的上传大小限制。无效的限制返回 503，避免静默放宽配置。 */
export function attachmentUploadLimit() {
  const configured = process.env.COMMUNICATION_ATTACHMENT_MAX_BYTES?.trim();
  if (!configured) return maxSingleUploadBytes;
  const limit = Number(configured);
  if (!/^\d+$/u.test(configured) || limit < 1 || limit > maxSingleUploadBytes) {
    throw new HTTPException(503, {
      res: Response.json(
        { message: "附件大小限制配置无效。" },
        { status: 503 }
      ),
    });
  }
  return limit;
}

function attachmentPath(communicationId: string) {
  return `/api/communications/${communicationId}/attachments`;
}

function requireLocalStorage(getStorage: GetAttachmentStorage) {
  const storage = getStorage();
  if (storage.kind !== "local") fail(404, "本地附件存储未启用。");
  return storage;
}

export function createAttachmentUseCases(
  db: Database,
  getStorage: GetAttachmentStorage,
  cleanup: Pick<
    AttachmentCleanup,
    | "confirmAttachmentCleanup"
    | "cleanupArchivedUpload"
    | "cleanupPendingLocalUpload"
  >
) {
  async function uploadStorage(fileSize: number) {
    const storage = await useStorage(getStorage);
    if (storage.kind === "local" && fileSize > maxLocalUploadBytes) {
      fail(400, "本地存储的单个附件不能超过 128 MiB。");
    }
    return storage;
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
    write: (tx: DatabaseTransaction) => Promise<T>,
    { allowDuringArchive = false } = {}
  ) {
    return db.transaction(async (tx) => {
      const { departmentId } = await requireCommunication(
        tx,
        access,
        communicationId
      );
      await lockDepartment(tx, departmentId, "share");
      const current = await readBusinessAccess(tx, access.userId);
      const record = await requireCommunication(
        tx,
        current,
        communicationId,
        departmentId
      );
      if (record.archiveStartedAt && !allowDuringArchive) {
        throw new CommunicationArchiveInProgress();
      }
      return write(tx);
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
   * @returns 上传会话。存储已收到文件时，upload 为 null，可继续完成校验。
   * @throws 无权访问、重复文件或同一上传 ID 对应的内容不同。
   */
  async function initCommunicationAttachment(
    access: BusinessAccess,
    communicationId: string,
    file: AttachmentUploadInput
  ) {
    const { row, existing, storage } = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const read = () =>
          findAttachmentUpload(tx, communicationId, file.uploadClientId);
        const previous = await read();
        if (previous) {
          assertSameUpload(previous, access, file);
          return {
            row: previous,
            existing: true,
            storage:
              previous.uploadState === "ready"
                ? null
                : await uploadStorage(previous.fileSize),
          };
        }

        const duplicate = await hasPublishedAttachmentWithHash(
          tx,
          communicationId,
          file.expectedContentSha256
        );
        if (duplicate) duplicateAttachment();
        const storage = await uploadStorage(file.fileSize);
        const created = await insertAttachmentUpload(
          tx,
          communicationId,
          access.userId,
          file
        );
        if (created) return { row: created, existing: false, storage };

        // 同一上传 ID 同时命中会话和对象键的唯一索引，读取先写入的会话。
        const winner = await read();
        if (!winner) fail(409, "上传会话已变化，请重试。");
        assertSameUpload(winner, access, file);
        return { row: winner, existing: true, storage };
      }
    );
    const canUpload =
      storage &&
      row.uploadState !== "ready" &&
      !(
        existing &&
        (await useStorage(
          async () =>
            (await storage.readSingleUploadMetadata(row.storageKey)) ??
            (await storage.readMetadata(row.storageKey))
        ))
      );
    const upload = !canUpload
      ? null
      : storage.kind === "local"
        ? {
            url: `${attachmentPath(communicationId)}/uploads/${row.uploadClientId}/content`,
            headers: { "content-type": row.mimeType },
            expiresAt: null,
          }
        : await withAttachmentWrite(access, communicationId, async (tx) => {
            // 元数据请求在事务外。签名前重新持锁确认沟通和会话仍可上传。
            const current = await lockAttachmentUpload(
              tx,
              communicationId,
              row.uploadClientId,
              access.userId
            );
            if (!current) fail(404, "附件上传已关闭。");
            assertSameUpload(current, access, file);
            if (current.uploadState === "ready") return null;
            return useStorage(() =>
              storage.createSingleUploadRequest(
                current.storageKey,
                current.fileSize,
                current.mimeType
              )
            );
          });
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
    const row = await lockAttachmentUpload(
      tx,
      communicationId,
      uploadClientId,
      access.userId
    );
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
  function getCommunicationAttachmentUpload(
    access: BusinessAccess,
    communicationId: string,
    uploadClientId: string
  ) {
    return withBusinessReadSnapshot(
      access.userId,
      async (tx, freshAccess) => {
        await requireCommunication(tx, freshAccess, communicationId);
        const row = await readAttachmentUploadState(
          tx,
          communicationId,
          uploadClientId,
          access.userId
        );
        return {
          state:
            row && !row.archivedAt ? row.uploadState : ("missing" as const),
        };
      },
      db
    );
  }

  /** 按当前沟通权限和原上传人校验，将请求体流式写入本地暂存区。 */
  async function writeLocalCommunicationAttachment(
    access: BusinessAccess,
    communicationId: string,
    uploadClientId: string,
    request: Request
  ) {
    const row = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const upload = await readUpload(
          tx,
          access,
          communicationId,
          uploadClientId
        );
        if (upload.archivedAt) fail(404, "附件上传已关闭。");
        return upload;
      }
    );
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
        await cleanup
          .cleanupPendingLocalUpload(row, storage, true)
          .catch(() => {});
      }
      throw error;
    }
  }

  async function inspectUpload(
    row: Attachment,
    storage: AttachmentStorage,
    beforePromotion: () => void
  ) {
    return useStorage(async () => {
      let metadata = await storage.readMetadata(row.storageKey);
      if (!metadata) {
        const staged = await storage.readSingleUploadMetadata(row.storageKey);
        if (staged) {
          if (staged.contentLength !== row.fileSize)
            fail(400, "附件实际大小与声明不一致。");
          beforePromotion();
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

  /**
   * 取消原上传人的未完成会话。先归档，再清理暂存和正式对象。
   * @param access 当前账号。
   * @param communicationId 所属沟通 ID。
   * @param uploadClientId 初始化时使用的上传 ID。
   * @returns `ready` 表示附件已发布并予以保留，`missing` 表示会话不存在或已清理。
   * @throws 无权访问沟通时返回 404，文件清理失败时返回 503，可用同一上传 ID 重试。
   */
  async function cancelCommunicationAttachmentUpload(
    access: BusinessAccess,
    communicationId: string,
    uploadClientId: string
  ) {
    const { state, row } = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const current = await lockAttachmentUpload(
          tx,
          communicationId,
          uploadClientId,
          access.userId
        );
        if (!current || current.objectDeletedAt) {
          return { state: "missing" as const, row: null };
        }
        if (current.archivedAt)
          return { state: "missing" as const, row: current };
        // 与完成请求竞争同一行锁，正常发布的附件继续保留。
        if (current.uploadState === "ready") {
          return { state: "ready" as const, row: null };
        }
        const archived = await archiveAttachment(tx, current.id, access.userId);
        return { state: "missing" as const, row: archived };
      },
      { allowDuringArchive: true }
    );
    if (row) await cleanup.confirmAttachmentCleanup(row);
    return { state };
  }

  async function archivePendingUpload(access: BusinessAccess, row: Attachment) {
    return withAttachmentWrite(access, row.communicationId, (tx) =>
      archiveOwnedPendingAttachment(tx, row.id, access.userId)
    );
  }

  function isUploadInaccessible(error: unknown) {
    return (
      error instanceof CommunicationArchiveInProgress ||
      (error instanceof HTTPException && [401, 403, 404].includes(error.status))
    );
  }

  /**
   * 校验正式对象，再用短事务重新检查权限及状态后发布附件。
   * @param access 当前账号。
   * @param communicationId 所属沟通 ID。
   * @param uploadClientId 初始化时获取的上传 ID。
   * @returns 可展示的附件元数据。重复完成请求返回同一条记录。
   * @throws 内容无效、重复文件、权限变化或存储未就绪时返回业务错误。
   */
  async function completeCommunicationAttachment(
    access: BusinessAccess,
    communicationId: string,
    uploadClientId: string
  ) {
    const start = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const row = await readUpload(
          tx,
          access,
          communicationId,
          uploadClientId
        );
        if (row.archivedAt) fail(404, "附件上传已关闭。");
        return row.uploadState === "ready"
          ? { ready: await readPublishedAttachment(tx, row.id), row: null }
          : { row, ready: null };
      }
    );
    if (!start.row) return start.ready;

    const row = start.row;
    const storage = await useStorage(getStorage);
    let mayHavePromoted = false;
    try {
      const verifiedHash = await inspectUpload(row, storage, () => {
        mayHavePromoted = true;
      });
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
            await publishAttachment(tx, current.id, verifiedHash);
          }
          return readPublishedAttachment(tx, current.id);
        }
      );
      // 只供上传使用的暂存对象可以独立回收，清理失败不撤销已发布的附件。
      await storage.removeSingleUpload(row.storageKey).catch(() => {});
      return result;
    } catch (error) {
      const duplicate = isDuplicateAttachmentError(error);
      const invalid = error instanceof HTTPException && error.status === 400;
      if (storage.kind === "local" && isUploadInaccessible(error)) {
        await cleanup
          .cleanupPendingLocalUpload(row, storage, mayHavePromoted)
          .catch(() => {});
      } else {
        if (duplicate || invalid) {
          await archivePendingUpload(access, row).catch(() => {});
        }
        // 完成与删除重叠时，补偿清理晚到的正式文件。
        await cleanup
          .cleanupArchivedUpload(row, storage, mayHavePromoted)
          .catch(() => {});
      }
      if (duplicate) duplicateAttachment();
      throw error;
    }
  }

  /**
   * 先归档阻止新下载，再删除存储文件。失败时保留可重试的归档记录。
   * @param access 当前账号。
   * @param communicationId 所属沟通 ID。
   * @param attachmentId 附件 ID。
   * @returns 删除完成或已完成时正常结束。
   */
  async function deleteCommunicationAttachment(
    access: BusinessAccess,
    communicationId: string,
    attachmentId: string
  ) {
    const row = await withAttachmentWrite(
      access,
      communicationId,
      async (tx) => {
        const current = await lockAttachment(tx, communicationId, attachmentId);
        if (!current) fail(404, "附件不存在。");
        if (current.objectDeletedAt) return null;
        if (current.archivedAt) return current;
        return archiveAttachment(tx, attachmentId, access.userId);
      }
    );
    if (row) await cleanup.confirmAttachmentCleanup(row);
  }

  function readDownloadableAttachment(
    access: BusinessAccess,
    communicationId: string,
    attachmentId: string
  ) {
    return withBusinessReadSnapshot(
      access.userId,
      async (tx, freshAccess) => {
        await requireCommunication(tx, freshAccess, communicationId);
        return selectDownloadableAttachment(tx, communicationId, attachmentId);
      },
      db
    );
  }

  return {
    initCommunicationAttachment,
    getCommunicationAttachmentUpload,
    writeLocalCommunicationAttachment,
    cancelCommunicationAttachmentUpload,
    completeCommunicationAttachment,
    deleteCommunicationAttachment,
    async readCommunicationAttachmentUploadLimit() {
      const { kind } = await useStorage(getStorage);
      const configuredLimit = attachmentUploadLimit();
      return {
        maxBytes:
          kind === "local"
            ? Math.min(configuredLimit, maxLocalUploadBytes)
            : configuredLimit,
      };
    },
    listCommunicationAttachments(
      access: BusinessAccess,
      communicationId: string,
      pagination: AttachmentPagination
    ) {
      return withBusinessReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          await requireCommunication(tx, freshAccess, communicationId);
          return selectAttachmentPage(tx, communicationId, pagination);
        },
        db
      );
    },
    /** 校验当前沟通权限和附件状态后，返回当前存储模式的下载地址。 */
    async downloadCommunicationAttachment(
      access: BusinessAccess,
      communicationId: string,
      attachmentId: string
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
    },

    /** 打开本地正式文件的流。每次请求链路都会重新检查沟通权限。 */
    async readLocalCommunicationAttachment(
      access: BusinessAccess,
      communicationId: string,
      attachmentId: string
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
    },

    /**
     * 按当前沟通权限读取已发布且未归档的原图或缩略图。
     * @param access 当前账号。
     * @param communicationId 所属沟通 ID。
     * @param attachmentId 附件 ID。
     * @param variant 要读取的图片版本。
     * @param signal 请求取消信号。
     * @returns 图片响应，原图保持原始文件字节。
     * @throws 无权查看及附件不可用时返回 404，非图片返回 415，存储失败时返回 503。
     */
    async readCommunicationAttachmentImage(
      access: BusinessAccess,
      communicationId: string,
      attachmentId: string,
      variant: "thumbnail" | "preview",
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
    },
    readCommunicationAttachmentDeletion(
      access: BusinessAccess,
      communicationId: string,
      attachmentId: string
    ) {
      return withBusinessReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          await requireCommunication(tx, freshAccess, communicationId);
          return readAttachmentDeletion(tx, communicationId, attachmentId);
        },
        db
      );
    },
  };
}
