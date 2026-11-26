import { Hono } from "hono";

import type {
  RecordAccessEnv,
  RecordAccessMiddleware,
} from "../../identity/http/record-access-context";
import type { CommunicationModule } from "../module";
import { createCommunicationAttachmentRoutes } from "./attachments";
import { createCommunicationRecordRoutes } from "./communication-records";
import { createCommunicationTagRoutes } from "./tags";

export function createCommunicationRoutes(
  { attachments, records, tags }: CommunicationModule,
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();
  routes.use("*", requireRecordAccess);
  routes.route("/", createCommunicationTagRoutes(tags));
  routes.route("/", createCommunicationAttachmentRoutes(attachments));
  routes.route("/", createCommunicationRecordRoutes(records));
  return routes;
}
