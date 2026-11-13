import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { CustomerList } from "@/components/customers/customer-list";
import { parseCustomerListQuery } from "@/components/customers/customer-list-query";
import type { CustomerListQuery } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/")({
  validateSearch: parseCustomerListQuery,
  component: CustomerListRoute,
});

function CustomerListRoute() {
  const query = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const updateQuery = useCallback(
    (
      update: (previous: CustomerListQuery) => CustomerListQuery,
      replace?: boolean
    ) => void navigate({ search: update, replace, resetScroll: false }),
    [navigate]
  );

  return (
    <CustomerList
      canCreate={viewer.role === "member" || viewer.role === "supervisor"}
      query={query}
      onQueryChange={updateQuery}
      onOpenCustomer={(customerId) =>
        void navigate({
          to: "/customers/$customerId",
          params: { customerId },
          state: { customerListQuery: query },
        })
      }
    />
  );
}
