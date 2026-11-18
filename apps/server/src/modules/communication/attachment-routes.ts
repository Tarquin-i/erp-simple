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
  cancelCommunicationAttachmentUpload,
  completeCommunicationAttachment,
  deleteCommunicationAttachment,
  downloadCommunicationAttachment,
  getCommunicationAttachmentUpload,
  initCommunicationAttachment,
  listCommunicationAttachments,
  readLocalCommunicationAttachment,
  writeLocalCommunicationAttachment,
} from "./attachments";

const path = "/:communicationId/attachments";
const uploadPath = `${path}/uploads/:uploadClientId`;

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

communicationAttachmentRoutes.get(uploadPath, async (c) => {
  const result = await getCommunicationAttachmentUpload(
    c.get("businessAccess"),
    readUuid(c.req.param("communicationId"), "沟通 ID"),
    readUuid(c.req.param("uploadClientId"), "上传 ID")
  );
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

communicationAttachmentRoutes.delete(uploadPath, async (c) => {
  const result = await cancelCommunicationAttachmentUpload(
    c.get("businessAccess"),
    readUuid(c.req.param("communicationId"), "沟通 ID"),
    readUuid(c.req.param("uploadClientId"), "上传 ID"),
    attachmentStorageFromEnv
  );
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

communicationAttachmentRoutes.put(`${uploadPath}/content`, async (c) => {
  await writeLocalCommunicationAttachment(
    c.get("businessAccess"),
    readUuid(c.req.param("communicationId"), "沟通 ID"),
    readUuid(c.req.param("uploadClientId"), "上传 ID"),
    c.req.raw,
    attachmentStorageFromEnv
  );
  return c.body(null, 204);
});

communicationAttachmentRoutes.post(`${uploadPath}/complete`, async (c) => {
  const communicationId = readUuid(c.req.param("communicationId"), "沟通 ID");
  const uploadClientId = readUuid(c.req.param("uploadClientId"), "上传 ID");
  // 文件转正和流式校验可能超过 Bun 默认的 HTTP 空闲时间。
  if (c.env) getBunServer<Bun.Server<unknown>>(c)?.timeout?.(c.req.raw, 0);
  const attachment = await completeCommunicationAttachment(
    c.get("businessAccess"),
    communicationId,
    uploadClientId,
    attachmentStorageFromEnv
  );
  return c.json({ attachment });
});

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

communicationAttachmentRoutes.get(`${path}/:attachmentId/content`, (c) =>
  readLocalCommunicationAttachment(
    c.get("businessAccess"),
    readUuid(c.req.param("communicationId"), "沟通 ID"),
    readUuid(c.req.param("attachmentId"), "附件 ID"),
    attachmentStorageFromEnv
  )
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
