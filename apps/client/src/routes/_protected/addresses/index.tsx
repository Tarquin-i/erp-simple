import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

import { AddressList } from "@/components/addresses/list";
import {
  addressDetailFromList,
  readAddressListQuery,
} from "@/components/addresses/navigation";
import type { AddressListQuery } from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/")({
  validateSearch: readAddressListQuery,
  component: AddressListPage,
});

function AddressListPage() {
  const query = Route.useSearch();
  const navigate = Route.useNavigate();
  const loadingDirectory = useRouterState({
    select: ({ isLoading, location, resolvedLocation }) =>
      isLoading && location.pathname === resolvedLocation?.pathname,
  });
  const onQueryChange = useCallback(
    (
      update: (previous: AddressListQuery) => AddressListQuery,
      replace?: boolean
    ) => void navigate({ search: update, replace, resetScroll: false }),
    [navigate]
  );

  return (
    <AddressList
      query={query}
      loadingDirectory={loadingDirectory}
      onQueryChange={onQueryChange}
      onOpenAddress={(addressId) =>
        void navigate(addressDetailFromList(addressId, query))
      }
    />
  );
}
