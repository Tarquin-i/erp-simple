import type { Hono } from "hono";
import type { createIdentityModule } from "../module";

export function registerIdentityRoutes(
  app: Hono,
  auth: ReturnType<typeof createIdentityModule>["auth"]
) {
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
}
