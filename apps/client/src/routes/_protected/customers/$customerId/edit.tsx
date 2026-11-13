import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/customer-form";
import { getCustomerListQuery } from "@/components/customers/customer-list-query";
import { getCustomer, listCustomerChannels } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/$customerId/edit")({
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params, abortController }) => {
      const [{ customer }, { channels }] = await Promise.all([
        getCustomer(params.customerId, abortController.signal),
        listCustomerChannels(abortController.signal),
      ]);
      return { customer, channels };
    },
  },
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: EditCustomerPage,
});

function EditCustomerPage() {
  const { customer, channels } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => getCustomerListQuery(location.state),
  });
  const navigate = Route.useNavigate();

  return (
    <CustomerForm
      key={customer.id}
      customer={customer}
      ownerName={customer.ownerName}
      channels={channels}
      onCancel={() => {
        void navigate({
          to: "/customers/$customerId",
          params: { customerId: customer.id },
          state: { customerListQuery },
          replace: true,
        });
      }}
      onSaved={() =>
        navigate({ to: "/customers", search: customerListQuery, replace: true })
      }
    />
  );
}
