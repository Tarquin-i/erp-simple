import { createFileRoute, useLocation } from "@tanstack/react-router";

import { useAttachmentUploadQueue } from "@/components/communication/attachments/use-upload-queue";
import {
  CommunicationForm,
  CommunicationFormLoadError,
  CommunicationFormPending,
} from "@/components/communication/form";
import { readCommunicationListQueryFromState } from "@/components/communication/list/query";
import { readCommunicationOrigin } from "@/components/communication/navigation";
import { readListQueryFromState } from "@/components/customers/list-query";
import { getCommunication } from "@/request/communication";
import type { Communication } from "@/request/communication";

export const Route = createFileRoute(
  "/_protected/communication/$communicationId/edit"
)({
  validateSearch: readCommunicationOrigin,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getCommunication(params.communicationId, abortController.signal),
  },
  pendingComponent: CommunicationFormPending,
  errorComponent: CommunicationFormLoadError,
  component: EditCommunicationPage,
});

function EditCommunicationPage() {
  const { viewer } = Route.useRouteContext();
  const { communication } = Route.useLoaderData();
  return (
    <EditCommunicationSession
      key={JSON.stringify([viewer.account.id, communication.id])}
      communication={communication}
    />
  );
}

function EditCommunicationSession({
  communication,
}: {
  communication: Communication;
}) {
  const { viewer } = Route.useRouteContext();
  const attachments = useAttachmentUploadQueue();
  const { customerId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { state } = useLocation();
  const customerListQuery = readListQueryFromState(state);
  const communicationListQuery = readCommunicationListQueryFromState(state);

  function returnToDetail() {
    return navigate({
      to: "/communication/$communicationId",
      params: { communicationId: communication.id },
      search: { customerId },
      state: { customerListQuery, communicationListQuery },
      replace: true,
    });
  }

  return (
    <CommunicationForm
      record={communication}
      viewer={viewer}
      attachments={attachments}
      onCancel={() => void returnToDetail()}
      onUnavailable={() => {
        void navigate({
          to: "/communication",
          search: communicationListQuery,
          replace: true,
        });
      }}
      onSaved={returnToDetail}
    />
  );
}
