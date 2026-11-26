import { Hono } from "hono";

import type { RecordAccessEnv } from "../../identity/http/record-access-context";
import type { CustomerModule } from "../module";

export function createCustomerChannelRoutes(
  listChannels: CustomerModule["listChannels"]
) {
  return new Hono<RecordAccessEnv>().get("/channels", async (context) => {
    return context.json({ channels: await listChannels() });
  });
}
