import { Buffer } from "node:buffer";

import { readUuid } from "../customer/input";
import { fail } from "../organization/errors";

export type AttachmentListCursor = {
  id: string;
  uploadedAt: string | null;
};

const cursorPattern = /^[A-Za-z0-9_-]+$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const invalidCursor = "附件分页游标无效。";

function isUtcTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !== 27 ||
    !timestampPattern.test(value) ||
    value.startsWith("0000-")
  ) {
    return false;
  }

  const instant = new Date(value);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 23) === value.slice(0, 23)
  );
}

/**
 * 将附件列表游标还原为排序键，保留数据库时间的微秒位。
 * @param cursor 请求中的 Base64URL 游标，省略表示首批。
 * @returns 附件 ID 和上传时间，空时间对应待清理的未完成上传。
 * @throws 游标格式或时间无效时返回 400。
 */
export function readAttachmentListCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  if (cursor.length > 128 || !cursorPattern.test(cursor)) {
    fail(400, invalidCursor);
  }
  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.toString("base64url") !== cursor) fail(400, invalidCursor);

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(400, invalidCursor);
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("uploadedAt" in value) ||
    typeof value.id !== "string" ||
    value.id.length !== 36 ||
    (value.uploadedAt !== null && !isUtcTimestamp(value.uploadedAt))
  ) {
    fail(400, invalidCursor);
  }

  return {
    id: readUuid(value.id, "附件分页游标"),
    uploadedAt: value.uploadedAt,
  };
}

/** 将本批最后一条记录的完整时间和 ID 编成下一批游标。 */
export function encodeAttachmentListCursor({
  id,
  uploadedAt,
}: AttachmentListCursor) {
  return Buffer.from(JSON.stringify({ id, uploadedAt }), "utf8").toString(
    "base64url"
  );
}
