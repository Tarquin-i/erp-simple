import { Hono } from "hono";
import { getBunServer } from "hono/bun";

import type { BusinessAccessEnv } from "../business/access";
import { readObject, readPositiveInteger, readUuid } from "../customer/input";
import {
  attachmentUploadFields,
  readAttachmentUpload,
} from "./attachment-files";
import { attachmentStorageFromEnv } from "./attachment-storage";
import {
  completeCommunicationAttachment,
  deleteCommunicationAttachment,
  downloadCommunicationAttachment,
  initCommunicationAttachment,
  listCommunicationAttachments,
} from "./attachments";

const path = "/:communicationId/attachments";

export const communicationAttachmentRoutes = new Hono<BusinessAccessEnv>();

communicationAttachmentRoutes.get(path, async (c) => {
  const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
  const result = await listCommunicationAttachments(
    c.get("businessAccess"),
    communicationId,
    {
      page: readPositiveInteger(c.req.query("page"), "页码", 1, 1_000_000),
      pageSize: readPositiveInteger(
        c.req.query("pageSize"),
        "每页条数",
        20,
        100
      ),
    }
  );
  return c.json(result);
});

communicationAttachmentRoutes.post(`${path}/uploads`, async (c) => {
  const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
  const body = await readObject(c, attachmentUploadFields);
  const result = await initCommunicationAttachment(
    c.get("businessAccess"),
    communicationId,
    readAttachmentUpload(body),
    attachmentStorageFromEnv
  );
  c.header("Cache-Control", "no-store");
  return c.json(result, 201);
});

communicationAttachmentRoutes.post(
  `${path}/uploads/:uploadClientId/complete`,
  async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const uploadClientId = readUuid(c.req.param("uploadClientId"), "上传 ID");
    // 文件转正和流式校验使用 OSS 自身的超时，允许超过 Bun 默认的 HTTP 空闲时间。
    if (c.env) getBunServer<Bun.Server<unknown>>(c)?.timeout?.(c.req.raw, 0);
    const attachment = await completeCommunicationAttachment(
      c.get("businessAccess"),
      communicationId,
      uploadClientId,
      attachmentStorageFromEnv
    );
    return c.json({ attachment });
  }
);

communicationAttachmentRoutes.get(
  `${path}/:attachmentId/download`,
  async (c) => {
    const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
    const attachmentId = readUuid(c.req.param("attachmentId"), "附件 ID");
    const result = await downloadCommunicationAttachment(
      c.get("businessAccess"),
      communicationId,
      attachmentId,
      attachmentStorageFromEnv
    );
    c.header("Cache-Control", "no-store");
    return c.json(result);
  }
);

communicationAttachmentRoutes.delete(`${path}/:attachmentId`, async (c) => {
  const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
  const attachmentId = readUuid(c.req.param("attachmentId"), "附件 ID");
  await deleteCommunicationAttachment(
    c.get("businessAccess"),
    communicationId,
    attachmentId,
    attachmentStorageFromEnv
  );
  return c.body(null, 204);
});
