import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/customer-form";
import { getCustomerListQuery } from "@/components/customers/customer-list-query";
import { listCustomerChannels } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/new")({
  beforeLoad: ({ context, location }) => {
    if (context.viewer.role === "company-admin") {
      throw redirect({
        to: "/customers",
        search: getCustomerListQuery(location.state),
        replace: true,
      });
    }
  },
  loader: ({ abortController }) => listCustomerChannels(abortController.signal),
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const { viewer } = Route.useRouteContext();
  const { channels } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => getCustomerListQuery(location.state),
  });
  const navigate = Route.useNavigate();
  const returnToList = () =>
    navigate({ to: "/customers", search: customerListQuery, replace: true });

  return (
    <CustomerForm
      ownerName={viewer.account.name}
      channels={channels}
      onCancel={() => void returnToList()}
      onSaved={returnToList}
    />
  );
}
