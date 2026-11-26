import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";
import { communication, communicationAttachment, user } from "@repo/db/schema";
import {
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { recordScopeWhere } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { fail } from "../../../errors";
import type { AttachmentUploadInput } from "../domain/attachment-files";

export type Attachment = typeof communicationAttachment.$inferSelect;
export type AttachmentListCursor = {
  id: string;
  uploadedAt: string | null;
};

const awaitingAttachmentCleanup = and(
  isNotNull(communicationAttachment.archivedAt),
  isNull(communicationAttachment.objectDeletedAt)
);

const visibleAttachment = and(
  isNull(communicationAttachment.objectDeletedAt),
  eq(communicationAttachment.uploadState, "ready")
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

export async function requireCommunication(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  communicationId: string,
  lockedDepartmentId?: string
) {
  const query = tx
    .select({
      departmentId: communication.departmentId,
      archiveStartedAt: communication.archiveStartedAt,
    })
    .from(communication)
    .where(
      and(
        eq(communication.id, communicationId),
        isNull(communication.archivedAt),
        recordScopeWhere(access, communication),
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

function attachmentForCommunication(
  communicationId: string,
  attachmentId: string
) {
  return and(
    eq(communicationAttachment.communicationId, communicationId),
    eq(communicationAttachment.id, attachmentId)
  );
}

export type AttachmentPagination = {
  pageSize: number;
} & ({ page: number } | { cursor: AttachmentListCursor | null });

function afterAttachmentCursor(cursor: AttachmentListCursor | null) {
  if (!cursor) return undefined;
  const { id, uploadedAt } = communicationAttachment;
  if (cursor.uploadedAt === null) {
    return and(isNull(uploadedAt), lt(id, cursor.id));
  }
  return or(
    isNull(uploadedAt),
    sql`(${uploadedAt}, ${id}) < (${cursor.uploadedAt}::timestamptz, ${cursor.id}::uuid)`
  );
}

/** 查询可用和待清理附件，保留游标中的 PostgreSQL 微秒时间。 */
export async function selectAttachmentPage(
  tx: DatabaseTransaction,
  communicationId: string,
  pagination: AttachmentPagination
) {
  const { pageSize } = pagination;
  const where = and(
    eq(communicationAttachment.communicationId, communicationId),
    visibleAttachment
  );
  if ("cursor" in pagination) {
    const rows = await tx
      .select({
        ...attachmentMetadata,
        // 直接读取 PostgreSQL 的微秒时间，避免游标经 JS Date 截成毫秒。
        uploadedAt: sql<
          string | null
        >`to_char(${communicationAttachment.uploadedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(communicationAttachment)
      .innerJoin(user, eq(user.id, communicationAttachment.uploaderUserId))
      .where(and(where, afterAttachmentCursor(pagination.cursor)))
      .orderBy(
        sql`${communicationAttachment.uploadedAt} desc nulls last`,
        desc(communicationAttachment.id)
      )
      .limit(pageSize + 1);
    const attachments = rows.slice(0, pageSize);
    const last = attachments.at(-1);
    return {
      attachments,
      nextCursor:
        rows.length > pageSize && last
          ? { id: last.id, uploadedAt: last.uploadedAt }
          : null,
      pageSize,
    };
  }

  const { page } = pagination;
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
}

export async function readDownloadableAttachment(
  tx: DatabaseTransaction,
  communicationId: string,
  attachmentId: string
) {
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
}

export async function readAttachmentDeletion(
  tx: DatabaseTransaction,
  communicationId: string,
  attachmentId: string
) {
  const [attachment] = await tx
    .select({
      archivedAt: communicationAttachment.archivedAt,
      objectDeletedAt: communicationAttachment.objectDeletedAt,
    })
    .from(communicationAttachment)
    .where(attachmentForCommunication(communicationId, attachmentId));
  if (!attachment) fail(404, "附件不存在。");
  if (attachment.objectDeletedAt) return { state: "deleted" } as const;
  if (attachment.archivedAt) return { state: "pending" } as const;
  return { state: "available" } as const;
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

export async function readPublishedAttachment(
  tx: DatabaseTransaction,
  attachmentId: string
) {
  const [row] = await tx
    .select(attachmentMetadata)
    .from(communicationAttachment)
    .innerJoin(user, eq(user.id, communicationAttachment.uploaderUserId))
    .where(eq(communicationAttachment.id, attachmentId));
  return row;
}

export async function findAttachmentUpload(
  tx: DatabaseTransaction,
  communicationId: string,
  uploadClientId: string
) {
  const [row] = await tx
    .select()
    .from(communicationAttachment)
    .where(uploadForCommunication(communicationId, uploadClientId));
  return row;
}

export async function hasPublishedAttachmentWithHash(
  tx: DatabaseTransaction,
  communicationId: string,
  expectedContentSha256: string
) {
  const [duplicate] = await tx
    .select({ id: communicationAttachment.id })
    .from(communicationAttachment)
    .where(
      and(
        eq(communicationAttachment.communicationId, communicationId),
        eq(communicationAttachment.contentSha256, expectedContentSha256),
        eq(communicationAttachment.uploadState, "ready"),
        isNull(communicationAttachment.archivedAt)
      )
    );
  return Boolean(duplicate);
}

export async function insertAttachmentUpload(
  tx: DatabaseTransaction,
  communicationId: string,
  uploaderUserId: string,
  file: AttachmentUploadInput
) {
  const [created] = await tx
    .insert(communicationAttachment)
    .values({
      ...file,
      communicationId,
      uploaderUserId,
      storageKey: `${file.uploadClientId.slice(0, 2)}/${communicationId}/${file.uploadClientId}`,
    })
    .onConflictDoNothing()
    .returning();
  return created;
}

export async function lockAttachmentUpload(
  tx: DatabaseTransaction,
  communicationId: string,
  uploadClientId: string,
  uploaderUserId: string
) {
  const [row] = await tx
    .select()
    .from(communicationAttachment)
    .where(uploadForUploader(communicationId, uploadClientId, uploaderUserId))
    .for("update");
  return row;
}

export async function readAttachmentUploadState(
  tx: DatabaseTransaction,
  communicationId: string,
  uploadClientId: string,
  uploaderUserId: string
) {
  const [row] = await tx
    .select({
      uploadState: communicationAttachment.uploadState,
      archivedAt: communicationAttachment.archivedAt,
    })
    .from(communicationAttachment)
    .where(uploadForUploader(communicationId, uploadClientId, uploaderUserId));
  return row;
}

export async function publishAttachment(
  tx: DatabaseTransaction,
  attachmentId: string,
  verifiedHash: string
) {
  await tx
    .update(communicationAttachment)
    .set({
      uploadState: "ready",
      contentSha256: verifiedHash,
      uploadedAt: sql`now()`,
    })
    .where(eq(communicationAttachment.id, attachmentId));
}

export async function archiveOwnedPendingAttachment(
  tx: DatabaseTransaction,
  attachmentId: string,
  uploaderUserId: string
) {
  const [archived] = await tx
    .update(communicationAttachment)
    .set({ archivedAt: sql`now()`, archivedByUserId: uploaderUserId })
    .where(
      and(
        eq(communicationAttachment.id, attachmentId),
        eq(communicationAttachment.uploaderUserId, uploaderUserId),
        eq(communicationAttachment.uploadState, "pending"),
        isNull(communicationAttachment.archivedAt)
      )
    )
    .returning();
  return archived;
}

export async function archiveAttachment(
  tx: DatabaseTransaction,
  attachmentId: string,
  archivedByUserId: string
) {
  const [archived] = await tx
    .update(communicationAttachment)
    .set({ archivedAt: sql`now()`, archivedByUserId })
    .where(eq(communicationAttachment.id, attachmentId))
    .returning();
  return archived;
}

export async function lockAttachment(
  tx: DatabaseTransaction,
  communicationId: string,
  attachmentId: string
) {
  const [row] = await tx
    .select()
    .from(communicationAttachment)
    .where(attachmentForCommunication(communicationId, attachmentId))
    .for("update");
  return row;
}

export function isDuplicateAttachmentError(error: unknown) {
  return isConstraintError(
    error,
    "23505",
    "communication_attachment_active_sha256_unique"
  );
}

export async function markAttachmentObjectDeleted(
  db: Database,
  row: Attachment
) {
  const [cleaned] = await db
    .update(communicationAttachment)
    .set({
      objectDeletedAt: sql`greatest(now(), ${communicationAttachment.archivedAt}, ${communicationAttachment.objectDeletedAt})`,
      cleanupFailureCount: 0,
      cleanupNextAttemptAt: null,
    })
    .where(
      and(
        eq(communicationAttachment.id, row.id),
        isNotNull(communicationAttachment.archivedAt),
        eq(communicationAttachment.cleanupGeneration, row.cleanupGeneration)
      )
    )
    .returning({ id: communicationAttachment.id });
  return Boolean(cleaned);
}

export async function readAttachmentObjectDeletedAt(
  db: Database,
  attachmentId: string
) {
  const [current] = await db
    .select({ objectDeletedAt: communicationAttachment.objectDeletedAt })
    .from(communicationAttachment)
    .where(eq(communicationAttachment.id, attachmentId));
  return current?.objectDeletedAt;
}

export async function closeCommunicationUploads(
  tx: DatabaseTransaction,
  communicationId: string,
  archivedByUserId: string,
  archivedAt: Date
) {
  await tx
    .update(communicationAttachment)
    .set({ archivedAt, archivedByUserId })
    .where(
      and(
        eq(communicationAttachment.communicationId, communicationId),
        eq(communicationAttachment.uploadState, "pending"),
        isNull(communicationAttachment.archivedAt)
      )
    );
}

export function readCommunicationAttachmentsToClean(
  tx: DatabaseTransaction,
  communicationId: string,
  limit: number
) {
  return tx
    .select()
    .from(communicationAttachment)
    .where(
      and(
        eq(communicationAttachment.communicationId, communicationId),
        awaitingAttachmentCleanup
      )
    )
    .orderBy(communicationAttachment.id)
    .limit(limit);
}

export async function claimAttachmentCleanupBatch(
  tx: DatabaseTransaction,
  includeAbandonedLocalUploads: boolean
) {
  const attachment = communicationAttachment;
  const expiredAt = sql`now() - interval '24 hours'`;
  // 常量谓词与部分索引一致，预备语句也能使用这些索引。
  const pending = sql`${attachment.uploadState} = 'pending'`;
  const abandonedLocalUpload = and(
    pending,
    isNull(attachment.archivedAt),
    isNull(attachment.objectDeletedAt),
    lt(attachment.createdAt, expiredAt)
  );
  // 已发出的 OSS 上传签名仍可能写入暂存路径。到期后再复查已关闭的会话。
  const closedByArchive = and(
    pending,
    lt(attachment.archivedAt, expiredAt),
    sql`${attachment.objectDeletedAt} - ${attachment.archivedAt} < interval '24 hours'`,
    exists(
      tx
        .select({ id: communication.id })
        .from(communication)
        .where(
          and(
            eq(communication.id, communicationAttachment.communicationId),
            or(
              isNotNull(communication.archiveStartedAt),
              isNotNull(communication.archivedAt)
            )
          )
        )
    )
  );
  const nextAttemptAt = attachment.cleanupNextAttemptAt;
  const due = or(isNull(nextAttemptAt), lte(nextAttemptAt, sql`now()`));
  const cleanupTime = sql`coalesce(${nextAttemptAt}, ${attachment.createdAt})`;
  const eligibility = [awaitingAttachmentCleanup, closedByArchive];
  if (includeAbandonedLocalUploads) eligibility.push(abandonedLocalUpload);
  const candidates = sql.join(
    eligibility.map(
      (condition) => sql`
        (select ${attachment.id} as id, ${cleanupTime} as cleanup_time
         from ${attachment}
         where ${and(due, condition)}
         order by cleanup_time, id)
      `
    ),
    sql` union all `
  );
  // 先合并各索引的顺序，再逐行复核并加锁。遇到已锁的行继续取下一条。
  const rows = await tx.execute<{ id: string }>(sql`
    select locked.id
    from (${candidates} order by cleanup_time, id) candidate
    cross join lateral (
      select ${attachment.id} as id
      from ${attachment}
      where ${and(
        sql`${attachment.id} = candidate.id`,
        sql`${cleanupTime} = candidate.cleanup_time`,
        due,
        or(...eligibility)
      )}
      for update skip locked
    ) locked
    order by candidate.cleanup_time, candidate.id
    limit 100
  `);

  if (!rows.length) return [];
  // 领取期内其他实例跳过这些记录。过期的本地会话同时标记关闭。
  return tx
    .update(communicationAttachment)
    .set({
      archivedAt: sql`coalesce(${communicationAttachment.archivedAt}, now())`,
      archivedByUserId: sql`coalesce(${communicationAttachment.archivedByUserId}, ${communicationAttachment.uploaderUserId})`,
      cleanupNextAttemptAt: sql`date_trunc('milliseconds', now()) + interval '30 minutes'`,
    })
    .where(
      inArray(
        communicationAttachment.id,
        rows.map(({ id }) => id)
      )
    )
    .returning();
}

export async function deferClaimedAttachmentCleanup(
  db: Database,
  row: Attachment,
  claimedAt: Date,
  failureCount: number,
  retryMinutes: number
) {
  // 只修改本次领取的代次和时间，期间成功清理或登记新补偿时保留新状态。
  await db
    .update(communicationAttachment)
    .set({
      cleanupFailureCount: failureCount,
      cleanupNextAttemptAt: sql`now() + ${retryMinutes} * interval '1 minute'`,
    })
    .where(
      and(
        eq(communicationAttachment.id, row.id),
        eq(communicationAttachment.cleanupGeneration, row.cleanupGeneration),
        eq(communicationAttachment.cleanupNextAttemptAt, claimedAt)
      )
    );
}

export async function registerLateAttachmentWrite(
  db: Database,
  attachmentId: string
) {
  const [row] = await db
    .update(communicationAttachment)
    .set({
      objectDeletedAt: null,
      cleanupGeneration: sql`${communicationAttachment.cleanupGeneration} + 1`,
      cleanupFailureCount: 0,
      cleanupNextAttemptAt: null,
    })
    .where(
      and(
        eq(communicationAttachment.id, attachmentId),
        isNotNull(communicationAttachment.archivedAt)
      )
    )
    .returning();
  return row;
}

export async function readArchivedAttachmentToClean(
  db: Database,
  attachmentId: string
) {
  const [row] = await db
    .select()
    .from(communicationAttachment)
    .where(
      and(
        eq(communicationAttachment.id, attachmentId),
        awaitingAttachmentCleanup
      )
    );
  return row;
}

export async function closePendingLocalUpload(db: Database, row: Attachment) {
  await db
    .update(communicationAttachment)
    .set({ archivedAt: sql`now()`, archivedByUserId: row.uploaderUserId })
    .where(
      and(
        eq(communicationAttachment.id, row.id),
        eq(communicationAttachment.uploadState, "pending"),
        isNull(communicationAttachment.archivedAt)
      )
    );
}
