import { Hono } from "hono";
import { createDatabase } from "@repo/db";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in apps/server/.env");
}

const database = createDatabase(databaseUrl);
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
