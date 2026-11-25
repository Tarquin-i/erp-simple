import { createFileRoute, useLocation } from "@tanstack/react-router";

import { EditPayoutForm } from "@/components/payouts/edit-form";
import {
  PayoutPageError,
  PayoutPagePending,
} from "@/components/payouts/load-state";
import {
  readPayoutListOrigin,
  useReturnToPayoutList,
} from "@/components/payouts/navigation";
import { getPayout } from "@/request/payouts";

export const Route = createFileRoute("/_protected/payouts/$payoutId/edit")({
  validateSearch: readPayoutListOrigin,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getPayout(params.payoutId, abortController.signal),
  },
  pendingComponent: PayoutPagePending,
  errorComponent: PayoutPageError,
  component: EditPayoutPage,
});

function EditPayoutPage() {
  const { payout } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { state } = useLocation();
  const returnToList = useReturnToPayoutList();

  return (
    <EditPayoutForm
      key={payout.id}
      payout={payout}
      onReturn={() => {
        void navigate({
          to: "/payouts/$payoutId",
          params: { payoutId: payout.id },
          search,
          state: { payoutListEntryIndex: state.payoutListEntryIndex },
          replace: true,
        });
      }}
      onUnavailable={() => returnToList(true)}
    />
  );
}
