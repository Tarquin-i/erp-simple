import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";

import { CreatePayoutForm } from "@/components/payouts/create-form";
import {
  payoutListSearchFromOrigin,
  readPayoutListOrigin,
} from "@/components/payouts/navigation";
import { replaceProductEntryAndGoBack } from "@/components/products/navigation";

export const Route = createFileRoute("/_protected/payouts/new")({
  validateSearch: readPayoutListOrigin,
  component: NewPayoutPage,
});

function NewPayoutPage() {
  const { viewer } = Route.useRouteContext();
  const search = Route.useSearch();
  const { state } = useLocation();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const fromList =
    state.payoutListEntryIndex === state.__TSR_index - 1 &&
    router.history.canGoBack();

  function cancel() {
    const destination = {
      to: "/payouts",
      search: payoutListSearchFromOrigin(search),
    } as const;
    if (fromList) {
      replaceProductEntryAndGoBack(
        router.history,
        router.buildLocation(destination).publicHref
      );
      return;
    }
    void navigate({ ...destination, replace: true });
  }

  return (
    <CreatePayoutForm
      key={viewer.account.id}
      onCancel={cancel}
      onCreated={(payoutId) => {
        void navigate({
          to: "/payouts/$payoutId",
          params: { payoutId },
          search,
          state: {
            payoutListEntryIndex: fromList
              ? state.payoutListEntryIndex
              : undefined,
          },
          replace: true,
        });
      }}
    />
  );
}
