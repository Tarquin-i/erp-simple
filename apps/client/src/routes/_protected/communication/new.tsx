import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  CommunicationForm,
  CommunicationFormLoadError,
  CommunicationFormPending,
} from "@/components/communication/form";
import { readCommunicationListQueryFromState } from "@/components/communication/list/query";
import { readCommunicationOrigin } from "@/components/communication/navigation";
import { readListQueryFromState } from "@/components/customers/list-query";
import { getCustomer } from "@/request/customers";

export const Route = createFileRoute("/_protected/communication/new")({
  validateSearch: readCommunicationOrigin,
  loaderDeps: ({ search }) => ({ customerId: search.customerId }),
  loader: async ({ deps: { customerId }, abortController }) => {
    if (!customerId) return {};
    const { customer } = await getCustomer(customerId, abortController.signal);
    return { customer };
  },
  pendingComponent: CommunicationFormPending,
  errorComponent: CommunicationFormLoadError,
  component: NewCommunicationPage,
});

function NewCommunicationPage() {
  const { viewer } = Route.useRouteContext();
  const { customer } = Route.useLoaderData();
  const { customerId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { state } = useLocation();
  const customerListQuery = readListQueryFromState(state);
  const communicationListQuery = readCommunicationListQueryFromState(state);

  function cancel() {
    if (customerId) {
      void navigate({
        to: "/customers/$customerId",
        params: { customerId },
        search: { tab: "communication" },
        state: { customerListQuery },
        replace: true,
      });
    } else {
      void navigate({
        to: "/communication",
        search: communicationListQuery,
        replace: true,
      });
    }
  }

  return (
    <CommunicationForm
      key={`${viewer.account.id}:${customerId ?? "new"}`}
      initialCustomer={customer}
      viewer={viewer}
      onCancel={cancel}
      onSaved={(id) =>
        navigate({
          to: "/communication/$communicationId",
          params: { communicationId: id },
          search: { customerId },
          state: { customerListQuery, communicationListQuery },
          replace: true,
        })
      }
    />
  );
}
