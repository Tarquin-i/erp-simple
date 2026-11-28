import type { Hono } from "hono";
import {
  createAddressRoutes,
  createCustomerAddressRoutes,
} from "../modules/address";
import { createCommunicationRoutes } from "../modules/communication";
import { createCustomerRoutes } from "../modules/customer";
import type {
  RecordAccessMiddleware,
  RequireAccountId,
} from "../modules/identity";
import { createOrganizationRoutes } from "../modules/organization";
import { createPayoutRoutes } from "../modules/payout";
import { createProductRoutes } from "../modules/product";

type ApiRouteDependencies = {
  organization: Parameters<typeof createOrganizationRoutes>[0];
  customer: Parameters<typeof createCustomerRoutes>[0];
  deliveryAddresses: Parameters<typeof createAddressRoutes>[0];
  communication: Parameters<typeof createCommunicationRoutes>[0];
  products: Parameters<typeof createProductRoutes>[0];
  payouts: Parameters<typeof createPayoutRoutes>[0];
  requireAccountId: RequireAccountId;
  requireRecordAccess: RecordAccessMiddleware;
};

export function registerApiRoutes(
  app: Hono,
  {
    organization,
    customer,
    deliveryAddresses,
    communication,
    products,
    payouts,
    requireAccountId,
    requireRecordAccess,
  }: ApiRouteDependencies
) {
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
  app.route(
    "/api/products",
    createProductRoutes(products, requireRecordAccess)
  );
  app.route("/api/payouts", createPayoutRoutes(payouts, requireRecordAccess));
}
