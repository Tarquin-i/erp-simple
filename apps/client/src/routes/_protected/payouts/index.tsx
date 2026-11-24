import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useCallback } from "react";

import { PayoutList } from "@/components/payouts/list";
import { readPayoutListSearch } from "@/components/payouts/navigation";
import type { PayoutListSearch } from "@/components/payouts/navigation";
import { replaceProductEntryAndGoBack } from "@/components/products/navigation";

declare module "@tanstack/react-router" {
  interface HistoryState {
    payoutPreviousListHref?: string;
  }
}

export const Route = createFileRoute("/_protected/payouts/")({
  validateSearch: readPayoutListSearch,
  component: PayoutListPage,
});

function PayoutListPage() {
  const query = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { state } = useLocation();
  const changeQuery = useCallback(
    (
      update: (query: PayoutListSearch) => PayoutListSearch,
      replace?: boolean
    ) => {
      const current = router.state.location;
      if (replace) {
        const destination = router.buildLocation({
          to: "/payouts",
          search: update,
        });
        if (
          current.state.payoutPreviousListHref === destination.href &&
          router.history.canGoBack()
        ) {
          replaceProductEntryAndGoBack(router.history, destination.publicHref);
          return;
        }
      }
      void navigate({
        search: update,
        replace,
        state: replace ? true : { payoutPreviousListHref: current.href },
        resetScroll: false,
      });
    },
    [navigate, router]
  );

  return (
    <PayoutList
      query={query}
      entryIndex={state.__TSR_index}
      onChangeQuery={changeQuery}
    />
  );
}
