import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const server = {
  port: Number(process.env.SERVER_PORT || 4201),
  fetch: app.fetch,
};

export default server;
