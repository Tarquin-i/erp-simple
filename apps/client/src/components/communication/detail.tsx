import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Archive, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { readListQueryFromState } from "@/components/customers/list-query";
import { DetailField } from "@/components/shared/detail-field";
import { ExpandableText } from "@/components/shared/expandable-text";
import { toastManager } from "@/components/shared/toast";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  archiveCommunication,
  CommunicationApiError,
  communicationStatusLabels,
  getCommunication,
  isCommunicationSnapshot,
  updateCommunication,
} from "@/request/communication";
import type {
  Communication,
  CommunicationStatus,
} from "@/request/communication";

import { AttachmentQueue } from "./attachments/queue";
import { CommunicationAttachmentsTab } from "./attachments/tab";
import { useAttachmentUploadQueue } from "./attachments/use-upload-queue";
import type { AttachmentCommunicationIssue } from "./attachments/use-upload-queue";
import { CommunicationCustomerLink } from "./customer-link";
import { readCommunicationListQueryFromState } from "./list/query";
import type { CommunicationOrigin } from "./navigation";

const uncertainArchive = "暂时无法确认归档结果，请重试。";

export function CommunicationDetail({
  communication,
  origin,
}: {
  communication: Communication;
  origin: CommunicationOrigin;
}) {
  const router = useRouter();
  const { state } = useLocation();
  const [record, setRecord] = useState(communication);
  const [activeTab, setActiveTab] = useState("attachments");
  const [attachmentActionsSlot, setAttachmentActionsSlot] =
    useState<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [attachmentArchiving, setAttachmentArchiving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveIssue, setArchiveIssue] = useState("");
  const [archiveRetryVersion, setArchiveRetryVersion] = useState<number>();
  const [conflict, setConflict] = useState<{
    current: Communication;
    status: CommunicationStatus;
  } | null>(null);
  const saving = useRef(false);
  const returnCustomerId = customerReturnId(record);
  const archiving = attachmentArchiving || Boolean(record.archiveStartedAt);
  const writeLocked = archivePending || archiving || Boolean(record.archivedAt);
  const onAttachmentIssue = useCallback(
    (issue: AttachmentCommunicationIssue) => {
      setConflict(null);
      if (issue.state === "unavailable") {
        setArchiveOpen(false);
        setUnavailable(true);
        setError("此沟通记录已不可访问，无法继续处理附件。");
        return;
      }

      const latest = issue.communication;
      setAttachmentArchiving(true);
      if (latest) {
        setRecord((current) =>
          latest.version >= current.version ? latest : current
        );
      }
    },
    []
  );
  const uploads = useAttachmentUploadQueue(onAttachmentIssue);

  useEffect(() => {
    if (!attachmentArchiving || record.archiveStartedAt || unavailable) return;

    // 先按接口给出的归档状态上锁，再取最新详情和可续做的版本。
    const controller = new AbortController();
    void getCommunication(record.id, controller.signal).then(
      ({ communication: latest }) => {
        if (!controller.signal.aborted && latest.archiveStartedAt) {
          onAttachmentIssue({ state: "archiving", communication: latest });
        }
      },
      (failure: unknown) => {
        if (
          !controller.signal.aborted &&
          failure instanceof CommunicationApiError &&
          [401, 403, 404].includes(failure.status)
        ) {
          onAttachmentIssue({ state: "unavailable" });
        }
      }
    );
    return () => controller.abort();
  }, [
    attachmentArchiving,
    onAttachmentIssue,
    record.archiveStartedAt,
    record.id,
    unavailable,
  ]);

  function customerReturnId(current: Communication) {
    return current.canViewCustomer &&
      current.customer?.status !== "archived" &&
      origin.customerId === current.customerId
      ? origin.customerId
      : undefined;
  }

  async function submitArchive() {
    if (saving.current) return;
    saving.current = true;
    setArchivePending(true);
    setArchiveIssue("");
    setError("");
    const expectedVersion = archiveRetryVersion ?? record.version;
    let leftDetail = false;
    const unsubscribe = router.history.subscribe(() => {
      leftDetail = true;
    });

    try {
      const { communication: archived } = await archiveCommunication(
        record.id,
        expectedVersion
      );
      if (leftDetail) return;
      setRecord(archived);
      setArchiveOpen(false);
      toastManager.add({ title: "沟通记录已归档" });
      const customerId = customerReturnId(archived);
      if (customerId) {
        void router.navigate({
          to: "/customers/$customerId",
          params: { customerId },
          search: {
            tab: "communication",
            communicationPage: origin.communicationPage,
          },
          state: { customerListQuery: readListQueryFromState(state) },
          replace: true,
        });
      } else {
        void router.navigate({
          to: "/communication",
          search: readCommunicationListQueryFromState(state),
          replace: true,
        });
      }
    } catch (failure) {
      if (leftDetail) return;
      const apiError =
        failure instanceof CommunicationApiError ? failure : undefined;
      if (
        apiError?.code === "version_conflict" &&
        isCommunicationSnapshot(apiError.current, record.id)
      ) {
        setRecord(apiError.current);
        setArchiveOpen(false);
        setArchiveRetryVersion(undefined);
        setError("沟通记录已更新，请核对最新资料后再确认归档。");
        return;
      }
      if (apiError && [401, 403, 404].includes(apiError.status)) {
        setArchiveOpen(false);
        setUnavailable(true);
        setError(apiError.message);
        return;
      }

      const mayHaveStarted =
        !apiError ||
        apiError.status >= 500 ||
        apiError.status === 408 ||
        apiError.status === 429 ||
        apiError.code === "archive_cleanup_pending";
      setArchiveIssue(apiError?.message ?? uncertainArchive);
      setArchiveRetryVersion(mayHaveStarted ? expectedVersion : undefined);
      if (mayHaveStarted) {
        // 归档可能已开始，继续时保留原版本以核对同一次操作。
        const latest = await getCommunication(record.id).catch(() => undefined);
        if (!leftDetail && latest) setRecord(latest.communication);
      }
    } finally {
      unsubscribe();
      saving.current = false;
      if (!leftDetail) setArchivePending(false);
    }
  }

  /** 保存状态时核对版本，冲突时只允许按弹窗展示的版本重试。 */
  async function saveStatus(
    status: CommunicationStatus,
    expectedVersion = record.version
  ) {
    if (saving.current || writeLocked) return;
    saving.current = true;
    setPending(true);
    setError("");
    let leftDetail = false;
    const unsubscribe = router.history.subscribe(() => {
      leftDetail = true;
    });
    try {
      const { communication: updated } = await updateCommunication(record.id, {
        status,
        expectedVersion,
      });
      if (leftDetail) return;
      setRecord(updated);
      setConflict(null);
    } catch (failure) {
      if (leftDetail) return;
      if (
        failure instanceof CommunicationApiError &&
        failure.code === "version_conflict" &&
        isCommunicationSnapshot(failure.current, record.id)
      ) {
        setRecord(failure.current);
        setConflict(
          failure.current.archiveStartedAt || failure.current.status === status
            ? null
            : { current: failure.current, status }
        );
        return;
      }
      setConflict(null);
      if (
        failure instanceof CommunicationApiError &&
        failure.code === "archive_in_progress"
      ) {
        onAttachmentIssue({ state: "archiving" });
      }
      if (
        failure instanceof CommunicationApiError &&
        [401, 403, 404].includes(failure.status)
      ) {
        setUnavailable(true);
      }
      setError(
        failure instanceof Error ? failure.message : "更新状态失败，请重试。"
      );
    } finally {
      unsubscribe();
      saving.current = false;
      if (!leftDetail) setPending(false);
    }
  }

  if (unavailable) {
    return (
      <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="text-xl font-semibold">无法查看此沟通记录</h1>
        <FieldError>{error}</FieldError>
        <Button asChild variant="outline">
          <Link
            to="/communication"
            search={readCommunicationListQueryFromState(state)}
            replace
          >
            返回沟通列表
          </Link>
        </Button>
        <AttachmentQueue
          items={uploads.items
            .filter(({ status }) => status !== "succeeded")
            .map((item) => ({ ...item, error: undefined }))}
        />
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-anywhere">
          {record.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {archiving && <Badge variant="outline">归档中</Badge>}
          {returnCustomerId && (
            <Button asChild variant="outline" className="h-10 px-4">
              <Link
                to="/customers/$customerId"
                params={{ customerId: returnCustomerId }}
                search={{
                  tab: "communication",
                  communicationPage: origin.communicationPage,
                }}
                state={{ customerListQuery: state.customerListQuery }}
              >
                返回客户沟通记录
              </Link>
            </Button>
          )}
          {/* 从客户页签进入编辑时复用详情的历史位置。 */}
          {!writeLocked && (
            <Button asChild className="h-10 px-4">
              <Link
                to="/communication/$communicationId/edit"
                preload={false}
                replace={Boolean(returnCustomerId)}
                params={{ communicationId: record.id }}
                search={returnCustomerId ? origin : {}}
                state={{
                  communicationEditFromDetail: returnCustomerId
                    ? undefined
                    : record.id,
                  communicationListQuery: state.communicationListQuery,
                  customerListQuery: state.customerListQuery,
                }}
              >
                <Pencil data-icon="inline-start" />
                编辑
              </Link>
            </Button>
          )}
          <AlertDialog
            open={archiveOpen}
            onOpenChange={(open) => {
              if (!archivePending) setArchiveOpen(open);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                className="h-10 px-4"
                disabled={
                  pending || archivePending || Boolean(record.archivedAt)
                }
              >
                <Archive data-icon="inline-start" />
                {archiving || archiveRetryVersion !== undefined
                  ? "继续归档"
                  : "归档"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="w-[calc(100%-2rem)] grid-cols-1">
              <AlertDialogHeader>
                <AlertDialogTitle>归档沟通记录</AlertDialogTitle>
                <AlertDialogDescription className="min-w-0 wrap-anywhere">
                  「{record.title}
                  」归档后将从列表移除。已上传的附件会保留，未完成的上传会取消。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <FieldError>{archiveIssue}</FieldError>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={archivePending}>
                  {archiving ? "关闭" : "取消"}
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={archivePending}
                  aria-busy={archivePending}
                  onClick={(event) => {
                    event.preventDefault();
                    void submitArchive();
                  }}
                >
                  {archivePending
                    ? "正在归档…"
                    : archiveRetryVersion !== undefined
                      ? "重试归档"
                      : archiving
                        ? "继续归档"
                        : "确认归档"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {error && (
        <FieldError className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
          {error}
        </FieldError>
      )}

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <DetailField label="客户">
          <CommunicationCustomerLink
            customer={record.canViewCustomer ? record.customer : null}
            showNumber
          />
        </DetailField>
        <DetailField label="标签">
          <div className="flex flex-wrap gap-1.5">
            {record.tags.length ? (
              record.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </DetailField>
        <DetailField label="业务员">{record.ownerName}</DetailField>
        <DetailField label="状态">
          <Select
            value={record.status}
            disabled={pending || writeLocked || conflict !== null}
            onValueChange={(next) => {
              if (next !== record.status)
                void saveStatus(next as CommunicationStatus);
            }}
          >
            <SelectTrigger
              aria-label="状态"
              aria-busy={pending}
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(communicationStatusLabels).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </DetailField>
        <DetailField label="初次沟通内容" className="sm:col-span-2">
          <ExpandableText text={record.summary} />
        </DetailField>
      </dl>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mt-6 gap-4"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 overflow-x-auto overflow-y-hidden py-1">
            <TabsList aria-label="沟通关联信息" animatedIndicator>
              <TabsTrigger
                className="min-w-[72px] sm:min-w-[88px]"
                value="attachments"
              >
                附件
              </TabsTrigger>
              <TabsTrigger
                className="min-w-[72px] sm:min-w-[88px]"
                value="relations"
              >
                关联项
              </TabsTrigger>
            </TabsList>
          </div>
          <div
            ref={setAttachmentActionsSlot}
            className="ml-auto flex shrink-0 items-center gap-1 empty:hidden"
          />
        </div>
        <TabsContent
          value="attachments"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <CommunicationAttachmentsTab
            communicationId={record.id}
            readOnly={writeLocked}
            archiving={archiving}
            uploads={uploads}
            onCommunicationIssue={onAttachmentIssue}
            actionsSlot={
              activeTab === "attachments" ? attachmentActionsSlot : null
            }
          />
        </TabsContent>
        <TabsContent value="relations">
          <p className="py-8 text-center text-sm text-muted-foreground">
            待开发
          </p>
        </TabsContent>
      </Tabs>
      <VersionConflictDialog
        differences={
          conflict
            ? [
                {
                  label: "状态",
                  current: communicationStatusLabels[conflict.current.status],
                  proposed: communicationStatusLabels[conflict.status],
                },
              ]
            : null
        }
        pending={pending}
        onCancel={() => {
          setConflict(null);
        }}
        onOverwrite={() => {
          if (conflict)
            void saveStatus(conflict.status, conflict.current.version);
        }}
      />
    </main>
  );
}
