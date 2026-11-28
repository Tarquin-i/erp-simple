import { Hono } from "hono";
import { auth, requireAccountId } from "./auth";
import { database } from "./database";
import { handleServerError } from "./errors";
import {
  createAddressModule,
  createAddressRoutes,
  createCustomerAddressRoutes,
} from "./modules/address";
import {
  createCommunicationModule,
  createCommunicationRoutes,
} from "./modules/communication";
import { createCustomerModule, createCustomerRoutes } from "./modules/customer";
import {
  createRecordAccessContext,
  registerIdentityRoutes,
} from "./modules/identity";
import {
  createOrganizationModule,
  createOrganizationRoutes,
} from "./modules/organization";
import { createPayoutModule, createPayoutRoutes } from "./modules/payout";
import { createProductModule, createProductRoutes } from "./modules/product";

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
app.route(
  "/api/organization",
  createOrganizationRoutes(organization, requireAccountId)
);
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
