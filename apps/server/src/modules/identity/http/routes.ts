import type { Hono } from "hono";
import type { IdentityModule } from "../module";

export function registerIdentityRoutes(
  app: Hono,
  auth: IdentityModule["auth"]
) {
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
}
