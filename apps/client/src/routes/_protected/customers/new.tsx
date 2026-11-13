import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/customer-form";
import { getCustomerListQuery } from "@/components/customers/customer-list-query";
import {
  listAssignableCustomerOwners,
  listCustomerChannels,
} from "@/request/customers";

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
  loader: async ({ abortController, context }) => {
    const { signal } = abortController;
    const [{ channels }, ownerOptions] = await Promise.all([
      listCustomerChannels(signal),
      context.viewer.role === "supervisor"
        ? listAssignableCustomerOwners(undefined, signal)
        : undefined,
    ]);
    return { channels, assignableOwners: ownerOptions?.owners };
  },
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const { viewer } = Route.useRouteContext();
  const { channels, assignableOwners } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => getCustomerListQuery(location.state),
  });
  const navigate = Route.useNavigate();
  const returnToList = () =>
    navigate({ to: "/customers", search: customerListQuery, replace: true });

  return (
    <CustomerForm
      owner={viewer.account}
      assignableOwners={assignableOwners}
      channels={channels}
      onCancel={() => void returnToList()}
      onSaved={returnToList}
    />
  );
}
