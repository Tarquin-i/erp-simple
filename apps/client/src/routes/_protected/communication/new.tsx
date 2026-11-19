import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAttachmentUploadQueue } from "@/components/communication/attachments/use-upload-queue";
import type { AttachmentUploadQueue } from "@/components/communication/attachments/use-upload-queue";
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
import { readCommunicationCreationSearch } from "@/components/communication/navigation";
import { readListQueryFromState } from "@/components/customers/list-query";
import { Button } from "@/components/ui/button";
import type { Communication } from "@/request/communication";
import { getCustomer } from "@/request/customers";
import type { Viewer } from "@/request/organization";

export const Route = createFileRoute("/_protected/communication/new")({
  validateSearch: readCommunicationCreationSearch,
  component: NewCommunicationPage,
});

type RecoveryState = {
  recovery?: CreationRecovery;
  error?: string;
  unavailable?: boolean;
};

function readRecovery(
  accountId: string,
  submissionId?: string,
  message?: string
): RecoveryState {
  try {
    const recovery = readCreationRecovery(accountId);
    if (submissionId && recovery?.submission.id !== submissionId) {
      return { unavailable: true };
    }
    return {
      recovery: recovery && message ? { ...recovery, message } : recovery,
    };
  } catch (failure) {
    return {
      error:
        failure instanceof Error ? failure.message : "无法读取本地提交记录。",
    };
  }
}

function NewCommunicationPage() {
  const { viewer } = Route.useRouteContext();
  const { customerId, submissionId } = Route.useSearch();
  return (
    <NewCommunicationSession
      key={JSON.stringify([viewer.account.id, customerId, submissionId])}
      viewer={viewer}
      customerId={customerId}
      submissionId={submissionId}
    />
  );
}

function NewCommunicationSession({
  viewer,
  customerId,
  submissionId,
}: {
  viewer: Viewer;
  customerId?: string;
  submissionId?: string;
}) {
  const accountId = viewer.account.id;
  const navigate = Route.useNavigate();
  const { state } = useLocation();
  const attachments = useAttachmentUploadQueue();
  const [recovered, setRecovered] = useState<Communication>();
  const [recoveryState, setRecovery] = useState(() =>
    readRecovery(accountId, submissionId, state.communicationRecoveryMessage)
  );
  const { recovery, error, unavailable } = recoveryState;
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

  function showRecovered(record: Communication) {
    return showSaved(
      record.id,
      record.canViewCustomer && record.customerId === customerId
        ? customerId
        : undefined
    );
  }

  if (recovered) {
    return (
      <CommunicationForm
        recoveredCreation={recovered}
        viewer={viewer}
        attachments={attachments}
        onCancel={cancelCreation}
        onSaved={() => showRecovered(recovered)}
      />
    );
  }

  // 恢复只依赖原请求。客户的当前查看权限由 API 按实际写入或回放路径校验。
  if (recovery) {
    return (
      <CommunicationCreationRecovery
        key={recovery.submission.id}
        accountId={accountId}
        recovery={recovery}
        onRecovered={async (communication) => {
          if (attachments.items.length) {
            // 同页确认写入成功后，再继续上传仍在本地的文件草稿。
            setRecovered(communication);
            if (!(await attachments.upload(communication.id))) return;
          }
          await showRecovered(communication);
        }}
        onReturn={returnToList}
      />
    );
  }

  if (error) {
    return (
      <CommunicationFormLoadError
        error={new Error(error)}
        reset={() =>
          setRecovery(
            readRecovery(
              accountId,
              submissionId,
              state.communicationRecoveryMessage
            )
          )
        }
      />
    );
  }

  if (unavailable) {
    return (
      <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          无法继续确认这笔提交
        </h1>
        <p className="text-sm text-muted-foreground">
          这笔提交的待确认状态已结束，请返回沟通列表核对保存结果。
        </p>
        <Button type="button" variant="outline" onClick={returnToList}>
          返回沟通列表
        </Button>
      </main>
    );
  }

  return (
    <NewCommunicationForm
      viewer={viewer}
      customerId={customerId}
      attachments={attachments}
      onCancel={cancelCreation}
      onPendingCreation={(pending) => setRecovery({ recovery: pending })}
      onSaved={(id) => showSaved(id, customerId)}
    />
  );
}

function NewCommunicationForm({
  viewer,
  customerId,
  attachments,
  onCancel,
  onPendingCreation,
  onSaved,
}: {
  viewer: Viewer;
  customerId?: string;
  attachments: AttachmentUploadQueue;
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
      attachments={attachments}
      onCancel={onCancel}
      onPendingCreation={onPendingCreation}
      onSaved={onSaved}
    />
  );
}
