import { createFileRoute, useLocation } from "@tanstack/react-router";

import { PayoutDetail } from "@/components/payouts/detail";
import {
  PayoutPageError,
  PayoutPagePending,
} from "@/components/payouts/load-state";
import {
  readPayoutListOrigin,
  useReturnToPayoutList,
} from "@/components/payouts/navigation";
import { getPayout } from "@/request/payouts";

export const Route = createFileRoute("/_protected/payouts/$payoutId/")({
  validateSearch: readPayoutListOrigin,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getPayout(params.payoutId, abortController.signal),
  },
  pendingComponent: PayoutPagePending,
  errorComponent: PayoutPageError,
  component: PayoutDetailPage,
});

function PayoutDetailPage() {
  const { payout } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { state } = useLocation();
  const returnToList = useReturnToPayoutList();

  return (
    <PayoutDetail
      key={payout.id}
      payout={payout}
      onEdit={() => {
        void navigate({
          to: "/payouts/$payoutId/edit",
          params: { payoutId: payout.id },
          search,
          state: { payoutListEntryIndex: state.payoutListEntryIndex },
          replace: true,
        });
      }}
      onReturn={returnToList}
    />
  );
}
