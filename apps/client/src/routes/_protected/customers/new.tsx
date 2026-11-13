import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/form/form";
import { readListQueryFromState } from "@/components/customers/list/list-query";
import {
  listAssignableCustomerOwners,
  listCustomerChannels,
} from "@/request/customers";
import { listDepartments } from "@/request/organization";

export const Route = createFileRoute("/_protected/customers/new")({
  loader: async ({ abortController, context }) => {
    const { signal } = abortController;
    const { role } = context.viewer;
    const [{ channels }, ownerOptions, departments] = await Promise.all([
      listCustomerChannels(signal),
      role === "supervisor"
        ? listAssignableCustomerOwners(undefined, signal)
        : undefined,
      role === "company-admin" ? listDepartments(signal) : undefined,
    ]);
    return { channels, assignableOwners: ownerOptions?.owners, departments };
  },
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const { viewer } = Route.useRouteContext();
  const { channels, assignableOwners, departments } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => readListQueryFromState(location.state),
  });
  const navigate = Route.useNavigate();
  const returnToList = () =>
    navigate({ to: "/customers", search: customerListQuery, replace: true });

  return (
    <CustomerForm
      owner={departments ? undefined : viewer.account}
      assignableOwners={assignableOwners}
      departments={departments}
      channels={channels}
      onCancel={() => void returnToList()}
      onSaved={returnToList}
    />
  );
}
