import { Hono } from "hono";
import { auth, requireAccountId } from "./auth";
import { database } from "./database";
import { handleServerError } from "./errors";
import { createAddressModule } from "./modules/address";
import {
  createAddressRoutes,
  createCustomerAddressRoutes,
} from "./modules/address/http/routes";
import { createCommunicationModule } from "./modules/communication";
import { createCommunicationRoutes } from "./modules/communication/http/routes";
import { createCustomerModule } from "./modules/customer";
import { createCustomerRoutes } from "./modules/customer/http/routes";
import { createRecordAccessContext } from "./modules/identity/http/record-access-context";
import { registerIdentityRoutes } from "./modules/identity/http/routes";
import { createOrganizationModule } from "./modules/organization";
import { createOrganizationRoutes } from "./modules/organization/http/routes";
import { createPayoutModule } from "./modules/payout";
import { createPayoutRoutes } from "./modules/payout/http/routes";
import { createProductModule } from "./modules/product";
import { createProductRoutes } from "./modules/product/http/routes";

const app = new Hono();
const customer = createCustomerModule(database.db);
const { deliveryAddresses } = createAddressModule(database.db);
const communication = createCommunicationModule(database.db);
const { products } = createProductModule(database.db);
const { payouts } = createPayoutModule(database.db);
const organization = createOrganizationModule(database.db);
const requireRecordAccess = createRecordAccessContext({
  requireAccountId,
  readAccess: organization.readAccountRecordAccess,
});

app.onError(handleServerError);
app.get("/", (c) => c.text("Hello Hono!"));
registerIdentityRoutes(app, auth);
app.route("/api/organization", createOrganizationRoutes(organization));
app.route(
  "/api/customers",
  createCustomerRoutes(
    customer,
    createCustomerAddressRoutes(deliveryAddresses.listCustomerAddresses),
    requireRecordAccess
  )
);
app.route(
  "/api/addresses",
  createAddressRoutes(deliveryAddresses, requireRecordAccess)
);
app.route(
  "/api/communications",
  createCommunicationRoutes(communication, requireRecordAccess)
);
app.route("/api/products", createProductRoutes(products, requireRecordAccess));
app.route("/api/payouts", createPayoutRoutes(payouts, requireRecordAccess));

// 接收请求前检查数据库连通性。检查失败时先关闭连接池，再中止启动。
try {
  await database.checkConnection();
} catch (error) {
  await database.close();
  throw new Error("Could not connect to PostgreSQL", { cause: error });
}

communication.startAttachmentUploadCleanup();

const server = {
  port: Number(process.env.SERVER_PORT || 4201),
  fetch: app.fetch,
};

export default server;
