import { Hono } from "hono";
import { handleServerError } from "./errors";
import { addressRoutes } from "./modules/address/routes";
import { startAttachmentUploadCleanup } from "./modules/communication/attachments";
import { communicationRoutes } from "./modules/communication/routes";
import { createCustomerModule } from "./modules/customer";
import { createCustomerRoutes } from "./modules/customer/http/routes";
import { auth, database } from "./modules/identity/auth/better-auth";
import { departmentAdminRoutes } from "./modules/organization/admin-routes";
import { departmentApplicationRoutes } from "./modules/organization/application-routes";
import { organizationReadRoutes } from "./modules/organization/read-routes";
import { payoutRoutes } from "./modules/payout/routes";
import { productRoutes } from "./modules/product/routes";

const app = new Hono();
const customer = createCustomerModule(database.db);

app.onError(handleServerError);
app.get("/", (c) => c.text("Hello Hono!"));
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/organization/admin", departmentAdminRoutes);
app.route("/api/organization", departmentApplicationRoutes);
app.route("/api/organization", organizationReadRoutes);
app.route("/api/customers", createCustomerRoutes(customer));
app.route("/api/addresses", addressRoutes);
app.route("/api/communications", communicationRoutes);
app.route("/api/products", productRoutes);
app.route("/api/payouts", payoutRoutes);

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
