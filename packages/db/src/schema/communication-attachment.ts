import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { communication } from "./communication";

// 首版单次直传的技术上限。业务限额由上传接口单独校验。
const maxSingleUploadBytes = 5 * 1024 ** 3;

export const communicationAttachmentUploadState = pgEnum(
  "communication_attachment_upload_state",
  ["pending", "ready"]
);

/** 记录单次直传的会话、正式对象和归档后的清理进度。 */
export const communicationAttachment = pgTable(
  "communication_attachment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communicationId: uuid("communication_id").notNull(),
    uploaderUserId: text("uploader_user_id").notNull(),
    uploadClientId: uuid("upload_client_id").notNull(),
    // 保存不含 Bucket 和业务前缀的相对键，下载显示用原文件名。
    storageKey: text("storage_key").notNull(),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    expectedContentSha256: varchar("expected_content_sha256", {
      length: 64,
    }).notNull(),
    // 只有完成接口复核 OSS 内容后，才保存实际哈希和上传完成时间。
    contentSha256: varchar("content_sha256", { length: 64 }),
    uploadState: communicationAttachmentUploadState("upload_state")
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: text("archived_by_user_id"),
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true }),
    // 迟到写入需要重新清理时推进代次，让旧清理的响应无法提前标记完成。
    cleanupGeneration: integer("cleanup_generation").default(0).notNull(),
  },
  (table) => [
    // 避免数据库级联删除附件记录后，失去可用于清理 OSS 对象的路径。
    foreignKey({
      name: "communication_attachment_communication_fk",
      columns: [table.communicationId],
      foreignColumns: [communication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "communication_attachment_uploader_fk",
      columns: [table.uploaderUserId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "communication_attachment_archive_actor_fk",
      columns: [table.archivedByUserId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    uniqueIndex("communication_attachment_upload_client_unique").on(
      table.communicationId,
      table.uploadClientId
    ),
    uniqueIndex("communication_attachment_storage_key_unique").on(
      table.storageKey
    ),
    // 去重只约束已验证且仍可用的附件；归档后释放该内容哈希。
    uniqueIndex("communication_attachment_active_sha256_unique")
      .on(table.communicationId, table.contentSha256)
      .where(
        sql`${table.uploadState} = 'ready' and ${table.archivedAt} is null`
      ),
    index("communication_attachment_communication_uploaded_idx").on(
      table.communicationId,
      table.uploadedAt,
      table.id
    ),
    index("communication_attachment_pending_cleanup_idx")
      .on(table.createdAt, table.id)
      .where(
        sql`${table.uploadState} = 'pending' and ${table.objectDeletedAt} is null`
      ),
    check(
      "communication_attachment_storage_key_check",
      sql`${table.storageKey} = left(${table.uploadClientId}::text, 2) || '/' || ${table.communicationId}::text || '/' || ${table.uploadClientId}::text`
    ),
    check(
      "communication_attachment_file_name_nonempty",
      sql`${table.fileName} ~ '[^[:space:]]'`
    ),
    check(
      "communication_attachment_mime_type_nonempty",
      sql`${table.mimeType} ~ '[^[:space:]]'`
    ),
    check(
      "communication_attachment_file_size_check",
      sql`${table.fileSize} between 0 and ${sql.raw(String(maxSingleUploadBytes))}`
    ),
    check(
      "communication_attachment_expected_sha256_check",
      sql`${table.expectedContentSha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "communication_attachment_completed_upload_check",
      sql`(${table.uploadState} = 'pending' and ${table.contentSha256} is null and ${table.uploadedAt} is null)
        or (${table.uploadState} = 'ready' and ${table.contentSha256} is not null
          and ${table.contentSha256} = ${table.expectedContentSha256} and ${table.uploadedAt} is not null)`
    ),
    check(
      "communication_attachment_archive_actor_check",
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`
    ),
    check(
      "communication_attachment_object_deleted_check",
      sql`${table.objectDeletedAt} is null or (${table.archivedAt} is not null and ${table.objectDeletedAt} >= ${table.archivedAt})`
    ),
  ]
);
