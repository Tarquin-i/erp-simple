import { Hono } from "hono";

import { customerAddressRoutes } from "../../address/routes";
import { requireBusinessAccess } from "../../business/access";
import type { BusinessAccessEnv } from "../../business/access";
import type { CustomerModule } from "../module";
import { createCustomerChannelRoutes } from "./channels";
import { createCustomerContactRoutes } from "./contacts";
import { createCustomerOwnerOptionRoutes } from "./owner-options";
import { createCustomerProfileRoutes } from "./profiles";
import { createCustomerTagRoutes } from "./tags";

export function createCustomerRoutes({
  contacts,
  listChannels,
  ownerOptions,
  profiles,
  tags,
}: CustomerModule) {
  const routes = new Hono<BusinessAccessEnv>();

  routes.use("*", requireBusinessAccess);
  routes.route("/", createCustomerChannelRoutes(listChannels));
  routes.route("/", createCustomerOwnerOptionRoutes(ownerOptions));
  routes.route("/", createCustomerTagRoutes(tags));
  routes.route("/", createCustomerContactRoutes(contacts));
  routes.route("/", customerAddressRoutes);
  routes.route("/", createCustomerProfileRoutes(profiles));

  return routes;
}
