import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { getBunServer } from "hono/bun";

import {
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import type { RecordAccessEnv } from "../../identity/http/record-access-context";
import { fail } from "../../../errors";
import { attachmentUploadLimit } from "../application/attachments";
import {
  listAttachmentMimeTypes,
  normalizeAttachmentFileName,
} from "../domain/attachment-files";
import type { AttachmentUploadInput } from "../domain/attachment-files";
import type { CommunicationModule } from "../module";
import type { AttachmentListCursor } from "../persistence/attachments";

const attachmentUploadFields = [
  "fileName",
  "fileSize",
  "mimeType",
  "contentSha256",
  "uploadClientId",
] as const;

const sha256Pattern = /^[0-9a-f]{64}$/u;
const octetStream = "application/octet-stream";

/**
 * 清理文件名并验证单次直传请求。
 * @param input 原始 JSON 元数据。contentSha256 是客户端计算的小写十六进制摘要。
 * @returns 可写入上传记录的标准化元数据。
 * @throws 文件名、文件类型、大小、摘要或上传 ID 不匹配时抛出 HTTP 400。
 */
function readAttachmentUpload(
  input: Record<string, unknown>
): AttachmentUploadInput {
  if (typeof input.fileName !== "string") fail(400, "请填写附件文件名。");
  const safeName = normalizeAttachmentFileName(input.fileName);
  const fileName = readString(safeName, "附件文件名", 512);
  const acceptedTypes = listAttachmentMimeTypes(fileName);
  if (!acceptedTypes) fail(400, "不支持该附件类型。");

  const declaredType = readString(input.mimeType, "附件类型", 255)
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const mimeType =
    declaredType === octetStream ? acceptedTypes[0] : declaredType;
  if (!acceptedTypes.includes(mimeType)) {
    fail(400, "附件扩展名与文件类型不匹配。");
  }

  const { fileSize, contentSha256 } = input;
  if (
    typeof fileSize !== "number" ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    fileSize > attachmentUploadLimit()
  ) {
    fail(400, "附件大小超出允许范围。");
  }
  if (
    typeof contentSha256 !== "string" ||
    contentSha256.length !== 64 ||
    !sha256Pattern.test(contentSha256)
  ) {
    fail(400, "请提交有效的附件 SHA-256 摘要。");
  }
  return {
    fileName,
    fileSize,
    mimeType,
    expectedContentSha256: contentSha256,
    uploadClientId: readUuid(input.uploadClientId, "上传 ID"),
  };
}

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
 * @returns 附件 ID 和上传时间，兼容上传时间为空的旧游标。
 * @throws 游标格式或时间无效时返回 400。
 */
function readAttachmentListCursor(cursor: string | undefined) {
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
function encodeAttachmentListCursor({ id, uploadedAt }: AttachmentListCursor) {
  return Buffer.from(JSON.stringify({ id, uploadedAt }), "utf8").toString(
    "base64url"
  );
}

const path = "/:communicationId/attachments";
const uploadPath = `${path}/uploads/:uploadClientId`;

export function createCommunicationAttachmentRoutes(
  attachments: CommunicationModule["attachments"]
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/attachment-upload-limit", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await attachments.readCommunicationAttachmentUploadLimit());
  });

  routes.get(path, async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const page = c.req.query("page");
    const cursor = c.req.query("cursor");
    if (page !== undefined && cursor !== undefined) {
      fail(400, "页码与游标不能同时使用。");
    }
    const pageSize = readPositiveInteger(
      c.req.query("pageSize"),
      "每页条数",
      20,
      100
    );
    const result = await attachments.listCommunicationAttachments(
      c.get("recordAccess"),
      communicationId,
      page === undefined
        ? { cursor: readAttachmentListCursor(cursor), pageSize }
        : { page: readPositiveInteger(page, "页码", 1, 1_000_000), pageSize }
    );
    if ("nextCursor" in result) {
      const nextCursor = result.nextCursor
        ? encodeAttachmentListCursor(result.nextCursor)
        : null;
      return c.json({ ...result, nextCursor });
    }
    return c.json(result);
  });

  routes.post(`${path}/uploads`, async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const body = await readObject(c, attachmentUploadFields);
    const result = await attachments.initCommunicationAttachment(
      c.get("recordAccess"),
      communicationId,
      readAttachmentUpload(body)
    );
    c.header("Cache-Control", "no-store");
    return c.json(result, 201);
  });

  routes.get(uploadPath, async (c) => {
    const result = await attachments.getCommunicationAttachmentUpload(
      c.get("recordAccess"),
      readUuid(c.req.param("communicationId"), "沟通 ID"),
      readUuid(c.req.param("uploadClientId"), "上传 ID")
    );
    c.header("Cache-Control", "no-store");
    return c.json(result);
  });

  routes.delete(uploadPath, async (c) => {
    const result = await attachments.cancelCommunicationAttachmentUpload(
      c.get("recordAccess"),
      readUuid(c.req.param("communicationId"), "沟通 ID"),
      readUuid(c.req.param("uploadClientId"), "上传 ID")
    );
    c.header("Cache-Control", "no-store");
    return c.json(result);
  });

  routes.put(`${uploadPath}/content`, async (c) => {
    await attachments.writeLocalCommunicationAttachment(
      c.get("recordAccess"),
      readUuid(c.req.param("communicationId"), "沟通 ID"),
      readUuid(c.req.param("uploadClientId"), "上传 ID"),
      c.req.raw
    );
    return c.body(null, 204);
  });

  routes.post(`${uploadPath}/complete`, async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const uploadClientId = readUuid(c.req.param("uploadClientId"), "上传 ID");
    // 文件转正和流式校验可能超过 Bun 默认的 HTTP 空闲时间。
    if (c.env) getBunServer<Bun.Server<unknown>>(c)?.timeout?.(c.req.raw, 0);
    const attachment = await attachments.completeCommunicationAttachment(
      c.get("recordAccess"),
      communicationId,
      uploadClientId
    );
    return c.json({ attachment });
  });

  routes.get(`${path}/:attachmentId/download`, async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const attachmentId = readUuid(c.req.param("attachmentId"), "附件 ID");
    const result = await attachments.downloadCommunicationAttachment(
      c.get("recordAccess"),
      communicationId,
      attachmentId
    );
    c.header("Cache-Control", "no-store");
    return c.json(result);
  });

  routes.get(`${path}/:attachmentId/content`, (c) =>
    attachments.readLocalCommunicationAttachment(
      c.get("recordAccess"),
      readUuid(c.req.param("communicationId"), "沟通 ID"),
      readUuid(c.req.param("attachmentId"), "附件 ID")
    )
  );

  for (const variant of ["thumbnail", "preview"] as const) {
    routes.get(`${path}/:attachmentId/${variant}`, (c) => {
      c.header("Cache-Control", "private, no-store");
      return attachments.readCommunicationAttachmentImage(
        c.get("recordAccess"),
        readUuid(c.req.param("communicationId"), "沟通 ID"),
        readUuid(c.req.param("attachmentId"), "附件 ID"),
        variant,
        c.req.raw.signal
      );
    });
  }

  routes.get(`${path}/:attachmentId`, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const result = await attachments.readCommunicationAttachmentDeletion(
      c.get("recordAccess"),
      readUuid(c.req.param("communicationId"), "沟通 ID"),
      readUuid(c.req.param("attachmentId"), "附件 ID")
    );
    return c.json(result);
  });

  routes.delete(`${path}/:attachmentId`, async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const attachmentId = readUuid(c.req.param("attachmentId"), "附件 ID");
    await attachments.deleteCommunicationAttachment(
      c.get("recordAccess"),
      communicationId,
      attachmentId
    );
    return c.body(null, 204);
  });

  return routes;
}
