import { Hono } from "hono";

import { requireBusinessAccess } from "../../business/access";
import type { BusinessAccessEnv } from "../../business/access";
import type { CommunicationModule } from "../module";
import { createCommunicationAttachmentRoutes } from "./attachments";
import { createCommunicationRecordRoutes } from "./communication-records";
import { createCommunicationTagRoutes } from "./tags";

export function createCommunicationRoutes({
  attachments,
  records,
  tags,
}: CommunicationModule) {
  const routes = new Hono<BusinessAccessEnv>();
  routes.use("*", requireBusinessAccess);
  routes.route("/", createCommunicationTagRoutes(tags));
  routes.route("/", createCommunicationAttachmentRoutes(attachments));
  routes.route("/", createCommunicationRecordRoutes(records));
  return routes;
}
