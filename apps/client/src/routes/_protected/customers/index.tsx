import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { CustomerList } from "@/components/customers/list";
import { parseListQuery } from "@/components/customers/list-query";
import type { CustomerListQuery } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/")({
  validateSearch: parseListQuery,
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
      canCreate={viewer.role !== "applicant"}
      query={query}
      onQueryChange={updateQuery}
      onOpenCustomer={(customerId) =>
        void navigate({
          to: "/customers/$customerId",
          params: { customerId },
          // 详情页返回时可用这份状态恢复列表的搜索、筛选和页码。
          state: { customerListQuery: query },
        })
      }
    />
  );
}
