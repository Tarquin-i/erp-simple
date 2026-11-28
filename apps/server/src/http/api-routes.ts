import type { Hono } from "hono";
import type { AddressModule } from "../modules/address";
import {
  createAddressRoutes,
  createCustomerAddressRoutes,
} from "../modules/address";
import type { CommunicationModule } from "../modules/communication";
import { createCommunicationRoutes } from "../modules/communication";
import type { CustomerModule } from "../modules/customer";
import { createCustomerRoutes } from "../modules/customer";
import type {
  RecordAccessMiddleware,
  RequireAccountId,
} from "../modules/identity";
import type { OrganizationModule } from "../modules/organization";
import { createOrganizationRoutes } from "../modules/organization";
import type { PayoutModule } from "../modules/payout";
import { createPayoutRoutes } from "../modules/payout";
import type { ProductModule } from "../modules/product";
import { createProductRoutes } from "../modules/product";

type ApiRouteDependencies = {
  organization: OrganizationModule;
  customer: CustomerModule;
  deliveryAddresses: AddressModule["deliveryAddresses"];
  communication: CommunicationModule;
  products: ProductModule["products"];
  payouts: PayoutModule["payouts"];
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
