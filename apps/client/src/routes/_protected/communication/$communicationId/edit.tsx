import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useRef } from "react";

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
  const origin = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { state } = useLocation();
  const returning = useRef<Promise<void> | undefined>(undefined);
  const customerListQuery = readListQueryFromState(state);
  const communicationListQuery = readCommunicationListQueryFromState(state);

  async function returnToDetail() {
    if (returning.current) return returning.current;

    if (
      state.communicationEditFromDetail === communication.id &&
      router.history.canGoBack()
    ) {
      // 从详情进入编辑时回到原历史记录，避免留下两个相同的详情页。
      returning.current = new Promise<void>((resolve) => {
        const unsubscribe = router.subscribe("onResolved", () => {
          unsubscribe();
          resolve();
        });
        router.history.back();
      });
      return returning.current;
    }

    await navigate({
      to: "/communication/$communicationId",
      params: { communicationId: communication.id },
      search: origin,
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
