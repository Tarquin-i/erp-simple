import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  CommunicationForm,
  CommunicationFormLoadError,
  CommunicationFormPending,
} from "@/components/communication/form";
import { CommunicationCreationRecovery } from "@/components/communication/form/creation-recovery";
import { readCreationRecovery } from "@/components/communication/form/creation-submission";
import type { CreationRecovery } from "@/components/communication/form/creation-submission";
import type { CustomerChoice } from "@/components/communication/form/customer-field";
import { readCommunicationListQueryFromState } from "@/components/communication/list/query";
import { readCommunicationOrigin } from "@/components/communication/navigation";
import { readListQueryFromState } from "@/components/customers/list-query";
import { getCustomer } from "@/request/customers";
import type { Viewer } from "@/request/organization";

export const Route = createFileRoute("/_protected/communication/new")({
  validateSearch: readCommunicationOrigin,
  component: NewCommunicationPage,
});

type RecoveryState = {
  recovery?: CreationRecovery;
  error?: string;
};

function readRecovery(accountId: string): RecoveryState {
  try {
    return { recovery: readCreationRecovery(accountId) };
  } catch (failure) {
    return {
      error:
        failure instanceof Error ? failure.message : "无法读取本地提交记录。",
    };
  }
}

function NewCommunicationPage() {
  const { viewer } = Route.useRouteContext();
  const { customerId } = Route.useSearch();
  return (
    <NewCommunicationSession
      key={JSON.stringify([viewer.account.id, customerId])}
      viewer={viewer}
      customerId={customerId}
    />
  );
}

function NewCommunicationSession({
  viewer,
  customerId,
}: {
  viewer: Viewer;
  customerId?: string;
}) {
  const accountId = viewer.account.id;
  const [recoveryState, setRecovery] = useState(() => readRecovery(accountId));
  const { recovery, error } = recoveryState;
  const navigate = Route.useNavigate();
  const { state } = useLocation();
  const customerListQuery = readListQueryFromState(state);
  const communicationListQuery = readCommunicationListQueryFromState(state);

  function returnToList() {
    void navigate({
      to: "/communication",
      search: communicationListQuery,
      replace: true,
    });
  }

  function cancelCreation() {
    if (!customerId) {
      returnToList();
      return;
    }
    void navigate({
      to: "/customers/$customerId",
      params: { customerId },
      search: { tab: "communication" },
      state: { customerListQuery },
      replace: true,
    });
  }

  function showSaved(id: string, originCustomerId: string | undefined) {
    return navigate({
      to: "/communication/$communicationId",
      params: { communicationId: id },
      search: { customerId: originCustomerId },
      state: { customerListQuery, communicationListQuery },
      replace: true,
    });
  }

  // 恢复只依赖原请求。客户的当前查看权限由 API 按实际写入或回放路径校验。
  if (recovery) {
    return (
      <CommunicationCreationRecovery
        key={recovery.submission.id}
        accountId={accountId}
        recovery={recovery}
        onRecovered={(communication) =>
          showSaved(
            communication.id,
            communication.canViewCustomer &&
              communication.customerId === customerId
              ? customerId
              : undefined
          )
        }
        onReturn={returnToList}
      />
    );
  }

  if (error) {
    return (
      <CommunicationFormLoadError
        error={new Error(error)}
        reset={() => setRecovery(readRecovery(accountId))}
      />
    );
  }

  return (
    <NewCommunicationForm
      viewer={viewer}
      customerId={customerId}
      onCancel={cancelCreation}
      onPendingCreation={(pending) => setRecovery({ recovery: pending })}
      onSaved={(id) => showSaved(id, customerId)}
    />
  );
}

function NewCommunicationForm({
  viewer,
  customerId,
  onCancel,
  onPendingCreation,
  onSaved,
}: {
  viewer: Viewer;
  customerId?: string;
  onCancel: () => void;
  onPendingCreation: (recovery: CreationRecovery) => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [result, setResult] = useState<
    { customer: CustomerChoice } | { error: unknown }
  >();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    void getCustomer(customerId, controller.signal).then(
      ({ customer }) => {
        if (!controller.signal.aborted) setResult({ customer });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ error });
      }
    );
    return () => controller.abort();
  }, [customerId, attempt]);

  if (customerId && !result) return <CommunicationFormPending />;
  if (result && "error" in result) {
    return (
      <CommunicationFormLoadError
        error={result.error}
        reset={() => {
          setResult(undefined);
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  return (
    <CommunicationForm
      initialCustomer={result?.customer}
      viewer={viewer}
      onCancel={onCancel}
      onPendingCreation={onPendingCreation}
      onSaved={onSaved}
    />
  );
}
