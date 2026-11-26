import { Hono } from "hono";

import type {
  RecordAccessEnv,
  RecordAccessMiddleware,
} from "../../identity/http/record-access-context";
import type { CustomerModule } from "../module";
import { createCustomerChannelRoutes } from "./channels";
import { createCustomerContactRoutes } from "./contacts";
import { createCustomerOwnerOptionRoutes } from "./owner-options";
import { createCustomerProfileRoutes } from "./profiles";
import { createCustomerTagRoutes } from "./tags";

export function createCustomerRoutes(
  { contacts, listChannels, ownerOptions, profiles, tags }: CustomerModule,
  customerAddressRoutes: Hono<RecordAccessEnv>,
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.use("*", requireRecordAccess);
  routes.route("/", createCustomerChannelRoutes(listChannels));
  routes.route("/", createCustomerOwnerOptionRoutes(ownerOptions));
  routes.route("/", createCustomerTagRoutes(tags));
  routes.route("/", createCustomerContactRoutes(contacts));
  routes.route("/", customerAddressRoutes);
  routes.route("/", createCustomerProfileRoutes(profiles));

  return routes;
}
