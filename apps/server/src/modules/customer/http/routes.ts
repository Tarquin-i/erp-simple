import { Hono } from "hono";

import { customerAddressRoutes } from "../../address/routes";
import { requireBusinessAccess } from "../../business/access";
import type { BusinessAccessEnv } from "../../business/access";
import { customerContactRoutes } from "../contacts";
import type { CustomerModule } from "../module";
import { createCustomerChannelRoutes } from "./channels";
import { createCustomerOwnerOptionRoutes } from "./owner-options";
import { createCustomerProfileRoutes } from "./profiles";
import { createCustomerTagRoutes } from "./tags";

export function createCustomerRoutes({
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
  routes.route("/", customerContactRoutes);
  routes.route("/", customerAddressRoutes);
  routes.route("/", createCustomerProfileRoutes(profiles));

  return routes;
}
