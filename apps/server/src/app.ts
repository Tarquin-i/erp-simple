import type { Database } from "@repo/db";
import { Hono } from "hono";
import { handleServerError } from "./errors";
import { registerApiRoutes } from "./http/api-routes";
import { createAddressModule } from "./modules/address";
import { createCommunicationModule } from "./modules/communication";
import { createCustomerModule } from "./modules/customer";
import type { RequireAccountId } from "./modules/identity";
import {
  createRecordAccessContext,
  registerIdentityRoutes,
} from "./modules/identity";
import { createOrganizationModule } from "./modules/organization";
import { createPayoutModule } from "./modules/payout";
import { createProductModule } from "./modules/product";

type AppDependencies = {
  db: Database;
  auth: Parameters<typeof registerIdentityRoutes>[1];
  requireAccountId: RequireAccountId;
};

export function createApp({ db, auth, requireAccountId }: AppDependencies) {
  const app = new Hono();
  const customer = createCustomerModule(db);
  const { deliveryAddresses } = createAddressModule(db);
  const communication = createCommunicationModule(db);
  const { products } = createProductModule(db);
  const { payouts } = createPayoutModule(db);
  const organization = createOrganizationModule(db);
  const requireRecordAccess = createRecordAccessContext({
    requireAccountId,
    readAccess: organization.readAccountRecordAccess,
  });

  app.onError(handleServerError);
  app.get("/", (c) => c.text("Hello Hono!"));
  registerIdentityRoutes(app, auth);
  registerApiRoutes(app, {
    organization,
    customer,
    deliveryAddresses,
    communication,
    products,
    payouts,
    requireAccountId,
    requireRecordAccess,
  });

  return {
    app,
    startAttachmentUploadCleanup: communication.startAttachmentUploadCleanup,
  };
}
