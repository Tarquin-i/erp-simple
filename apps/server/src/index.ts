import { createApp } from "./app";
import { auth, requireAccountId } from "./auth";
import { database } from "./database";

const { app, startAttachmentUploadCleanup } = createApp({
  db: database.db,
  auth,
  requireAccountId,
});

// 接收请求前检查数据库连通性。检查失败时先关闭连接池，再中止启动。
try {
  await database.checkConnection();
} catch (error) {
  await database.close();
  throw new Error("Could not connect to PostgreSQL", { cause: error });
}

startAttachmentUploadCleanup();

const server = {
  port: Number(process.env.SERVER_PORT || 4201),
  fetch: app.fetch,
};

export default server;
