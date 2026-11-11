import { Hono } from "hono";
import { auth, database } from "./modules/identity/auth/better-auth";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

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
