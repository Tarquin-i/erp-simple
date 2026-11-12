import { Hono } from "hono";
import { auth, database } from "./modules/identity/auth/better-auth";
import { departmentAdminRoutes } from "./modules/organization/admin-routes";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/organization/admin", departmentAdminRoutes);

try {
  await database.checkConnection();
} catch (error) {
  await database.close();
  throw new Error("Could not connect to PostgreSQL", { cause: error });
}

const server = {
  port: Number(process.env.SERVER_PORT || 4201),
  fetch: app.fetch,
};

export default server;
