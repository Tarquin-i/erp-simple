import { Hono } from "hono";

import { customerAddressRoutes } from "../../address/routes";
import { requireBusinessAccess } from "../../business/access";
import type { BusinessAccessEnv } from "../../business/access";
import { customerContactRoutes } from "../contacts";
import { customerDictionaryRoutes } from "../dictionaries";
import type { CustomerModule } from "../module";
import { customerProfileRoutes } from "../routes";
import { createCustomerChannelRoutes } from "./channels";

export function createCustomerRoutes({ listChannels }: CustomerModule) {
  const routes = new Hono<BusinessAccessEnv>();

  routes.use("*", requireBusinessAccess);
  routes.route("/", createCustomerChannelRoutes(listChannels));
  routes.route("/", customerDictionaryRoutes);
  routes.route("/", customerContactRoutes);
  routes.route("/", customerAddressRoutes);
  routes.route("/", customerProfileRoutes);

  return routes;
}
