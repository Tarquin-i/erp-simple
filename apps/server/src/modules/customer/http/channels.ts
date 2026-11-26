import { Hono } from "hono";

import type { BusinessAccessEnv } from "../../business/access";
import type { CustomerModule } from "../module";

export function createCustomerChannelRoutes(
  listChannels: CustomerModule["listChannels"]
) {
  return new Hono<BusinessAccessEnv>().get("/channels", async (context) => {
    return context.json({ channels: await listChannels() });
  });
}
