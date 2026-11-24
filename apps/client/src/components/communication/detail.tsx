import { Link, useLocation } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailField } from "@/components/shared/detail-field";
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
  CommunicationApiError,
  communicationStatusLabels,
  isCommunicationSnapshot,
  updateCommunication,
} from "@/request/communication";
import type {
  Communication,
  CommunicationStatus,
} from "@/request/communication";

import { CommunicationAttachmentsTab } from "./attachments/tab";
import { CommunicationCustomerLink } from "./customer-link";
import type { CommunicationOrigin } from "./navigation";

function CommunicationSummary({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    const element = paragraph.current;
    if (!element || expanded) return;
    const measure = () =>
      setHasMore(element.scrollHeight > element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, summary]);

  return (
    <>
      <p
        ref={paragraph}
        id={id}
        className={`leading-6 whitespace-pre-wrap wrap-anywhere${expanded ? "" : " line-clamp-3"}`}
      >
        {summary}
      </p>
      {(hasMore || expanded) && (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto px-0"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      )}
    </>
  );
}

export function CommunicationDetail({
  communication,
  origin,
}: {
  communication: Communication;
  origin: CommunicationOrigin;
}) {
  const { state } = useLocation();
  const [record, setRecord] = useState(communication);
  const [activeTab, setActiveTab] = useState("attachments");
  const [attachmentActionsSlot, setAttachmentActionsSlot] =
    useState<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [conflict, setConflict] = useState<{
    current: Communication;
    status: CommunicationStatus;
  } | null>(null);
  const saving = useRef(false);
  const returnCustomerId =
    record.canViewCustomer && origin.customerId === record.customerId
      ? origin.customerId
      : undefined;

  /** 保存状态时核对版本，冲突时只允许按弹窗展示的版本重试。 */
  async function saveStatus(
    status: CommunicationStatus,
    expectedVersion = record.version
  ) {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const { communication: updated } = await updateCommunication(record.id, {
        status,
        expectedVersion,
      });
      setRecord(updated);
      setConflict(null);
    } catch (failure) {
      if (
        failure instanceof CommunicationApiError &&
        failure.code === "version_conflict" &&
        isCommunicationSnapshot(failure.current, record.id)
      ) {
        setRecord(failure.current);
        setConflict(
          failure.current.status === status
            ? null
            : { current: failure.current, status }
        );
        return;
      }
      setConflict(null);
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
      saving.current = false;
      setPending(false);
    }
  }

  if (unavailable) {
    return (
      <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="text-xl font-semibold">无法查看此沟通记录</h1>
        <FieldError>{error}</FieldError>
        <Button asChild variant="outline">
          <Link to="/communication" search={state.communicationListQuery ?? {}}>
            返回沟通列表
          </Link>
        </Button>
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
            disabled={pending || conflict !== null}
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
          <CommunicationSummary summary={record.summary} />
        </DetailField>
      </dl>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mt-6 gap-4"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 overflow-x-auto overflow-y-hidden py-1">
            <TabsList aria-label="沟通关联信息">
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
