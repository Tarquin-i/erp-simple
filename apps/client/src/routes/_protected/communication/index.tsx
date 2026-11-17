import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { CommunicationList } from "@/components/communication/list";
import { parseCommunicationListQuery } from "@/components/communication/list/query";
import type { CommunicationListQuery } from "@/request/communication";

export const Route = createFileRoute("/_protected/communication/")({
  validateSearch: parseCommunicationListQuery,
  component: CommunicationListRoute,
});

function CommunicationListRoute() {
  const query = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const updateQuery = useCallback(
    (
      update: (previous: CommunicationListQuery) => CommunicationListQuery,
      replace?: boolean
    ) => void navigate({ search: update, replace, resetScroll: false }),
    [navigate]
  );

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <CommunicationList
        canCreate={viewer.role !== "applicant"}
        query={query}
        onQueryChange={updateQuery}
      />
    </main>
  );
}
