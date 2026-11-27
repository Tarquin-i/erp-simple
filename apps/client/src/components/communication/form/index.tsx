import { useRouter } from "@tanstack/react-router";
import { Check, Save } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { AttachmentDropZone } from "@/components/communication/attachments/drop-zone";
import { AttachmentQueue } from "@/components/communication/attachments/queue";
import {
  SavedAttachmentUploads,
  SavedAttachmentUploadStatus,
} from "@/components/communication/attachments/saved-uploads";
import type { AttachmentUploadQueue } from "@/components/communication/attachments/use-upload-queue";
import { CustomerSelectField } from "@/components/shared/customer-select-field";
import type { CustomerChoice } from "@/components/shared/customer-select-field";
import { TagMultiSelectField } from "@/components/shared/multi-select-fields";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CommunicationApiError,
  createCommunicationTag,
  getCommunication,
  isCommunicationSnapshot,
  listCommunicationTags,
  updateCommunication,
  updateCommunicationTagColor,
} from "@/request/communication";
import type { Communication } from "@/request/communication";
import { attachmentAccept } from "@/request/communication-attachments";
import type { Viewer } from "@/request/organization";

import { startCreationSubmission } from "./creation-submission";
import type { CreationRecovery } from "./creation-submission";
import { getChanges, getDifferences, rebaseDraft, toDraft } from "./draft";
import type { CommunicationDraft } from "./draft";
import { CommunicationOwnerField } from "./owner-field";

type Conflict = { current: Communication; draft: CommunicationDraft };

const formHeaderLayout = "flex flex-wrap items-center justify-between gap-4";
const formFieldsLayout = "grid gap-x-5 gap-y-4 md:grid-cols-2";

export function CommunicationFormPending() {
  return (
    <main
      className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
      aria-busy="true"
      aria-label="正在加载沟通表单"
    >
      <div aria-hidden="true" className={formHeaderLayout}>
        <Skeleton className="h-8 w-35" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-12.5 rounded-lg" />
          <Skeleton className="h-8 w-18 rounded-lg" />
        </div>
      </div>
      <div aria-hidden="true" className={formFieldsLayout}>
        {[
          ["title", "w-7"],
          ["customer", "w-7"],
          ["tags", "w-7"],
          ["owner", "w-10.5"],
        ].map(([field, labelWidth]) => (
          <Field key={field} className="min-w-0">
            <div className="h-lh text-sm leading-snug">
              <Skeleton className={`h-3 ${labelWidth}`} />
            </div>
            <Skeleton className="h-8" />
          </Field>
        ))}
        <Field className="min-w-0 md:col-span-2">
          <div className="h-lh text-sm leading-snug">
            <Skeleton className="h-3 w-21" />
          </div>
          <Skeleton className="h-36" />
        </Field>
      </div>
    </main>
  );
}

export function CommunicationFormLoadError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <h1 className="text-xl font-semibold">无法加载沟通表单</h1>
      <FieldError>
        {error instanceof Error ? error.message : "请稍后重试。"}
      </FieldError>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        重试
      </Button>
    </main>
  );
}

/** 提供沟通记录的新建、编辑表单及并发保存处理。 */
export function CommunicationForm({
  record,
  recoveredCreation,
  initialCustomer,
  viewer,
  attachments,
  onCancel,
  onUnavailable,
  onPendingCreation,
  onSaved,
}: {
  record?: Communication;
  recoveredCreation?: Communication;
  initialCustomer?: CustomerChoice;
  viewer: Viewer;
  attachments: AttachmentUploadQueue;
  onCancel: () => void;
  onUnavailable?: () => void;
  onPendingCreation?: (recovery: CreationRecovery) => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const isAdmin = viewer.role === "company-admin";
  const canAssign = isAdmin || viewer.role === "supervisor";
  const defaultOwner = isAdmin
    ? undefined
    : { id: viewer.account.id, name: viewer.account.name };
  const initialRecord = record ?? recoveredCreation;
  const [baseline, setBaseline] = useState(initialRecord);
  const [draft, setDraft] = useState(() =>
    toDraft(initialRecord, defaultOwner)
  );
  const [customer, setCustomer] = useState<CustomerChoice | null>(
    initialCustomer ?? null
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, setPending] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [archiveInProgress, setArchiveInProgress] = useState(false);
  const [assignmentDenied, setAssignmentDenied] = useState(false);
  const [saved, setSaved] = useState(
    recoveredCreation
      ? { id: recoveredCreation.id, recordSaved: true }
      : undefined
  );
  const saving = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(record);
  const savedId = saved?.id;
  const savedCreationId = isEdit ? undefined : savedId;
  const fieldsLocked = pending || archiveInProgress || Boolean(savedCreationId);
  const attachmentBusy = pending || archiveInProgress || attachments.busy;
  const customerChoice = baseline ? baseline.customer : customer;
  const customerId = baseline?.customerId ?? customer?.id;
  const canChangeOwner =
    canAssign &&
    !assignmentDenied &&
    (!baseline ||
      (baseline.canViewCustomer && baseline.customer?.status !== "archived"));
  const hasChanges =
    Object.keys(getChanges(toDraft(baseline), draft)).length > 0;
  const hasFiles = attachments.items.some((item) => item.status === "queued");
  const cannotSave =
    fieldsLocked ||
    tagPending ||
    (isEdit
      ? !hasChanges && !hasFiles
      : !customerId || (isAdmin && !draft.owner));
  const SubmitIcon = isEdit ? Check : Save;

  async function save(proposed: CommunicationDraft, current = baseline) {
    if (
      saving.current ||
      archiveInProgress ||
      savedId ||
      tagPending ||
      !customerId
    )
      return;
    saving.current = true;
    setPending(true);
    setError("");

    let leftForm = false;
    const unsubscribe = router.history.subscribe(() => {
      leftForm = true;
    });
    async function finishSave(id: string, recordSaved = false) {
      if (leftForm) return;
      setConflict(null);
      if (hasFiles) {
        setSaved({ id, recordSaved });
        if (!(await attachments.upload(id)) || leftForm) return;
      }
      await onSaved(id);
    }
    const changes = getChanges(toDraft(current), proposed);
    try {
      let id: string;
      let recordSaved = false;
      if (current) {
        id = current.id;
        if (Object.keys(changes).length) {
          await updateCommunication(current.id, {
            ...changes,
            expectedVersion: current.version,
          });
          recordSaved = true;
        }
      } else {
        const started = startCreationSubmission(viewer.account.id, {
          customerId,
          title: proposed.title.trim(),
          summary: proposed.summary.trim(),
          ownerUserId: canAssign ? proposed.owner?.id : undefined,
          tagIds: proposed.tags.map(({ id }) => id),
        });
        if (started.recovery) {
          onPendingCreation?.(started.recovery);
          return;
        }

        const result = await started.attempt;
        if (leftForm || result.status === "ended") return;
        if (result.status === "rejected") throw result.error;
        if (result.status === "pending") {
          onPendingCreation?.({
            submission: started.submission,
            message: result.message,
          });
          return;
        }
        id = result.communication.id;
        recordSaved = true;
      }
      await finishSave(id, recordSaved);
    } catch (failure) {
      if (leftForm) return;
      if (
        current &&
        failure instanceof CommunicationApiError &&
        failure.code === "archive_in_progress"
      ) {
        setConflict(null);
        setArchiveInProgress(true);
        setError(failure.message);
        return;
      }
      if (
        current &&
        failure instanceof CommunicationApiError &&
        failure.code === "version_conflict" &&
        isCommunicationSnapshot(failure.current, current.id)
      ) {
        const latest = toDraft(failure.current);
        const rebased = rebaseDraft(latest, proposed, changes);
        if (!Object.keys(getChanges(latest, rebased)).length) {
          await finishSave(current.id);
        } else {
          setConflict({ current: failure.current, draft: rebased });
        }
        return;
      }
      if (
        current &&
        failure instanceof CommunicationApiError &&
        [401, 403, 404].includes(failure.status)
      ) {
        // 主管降级后仍可能查看自己的记录，但不能改派业务员。
        const visible =
          failure.status === 403
            ? await getCommunication(current.id).catch(() => undefined)
            : undefined;
        if (leftForm) return;
        setConflict(null);
        if (!visible) {
          setUnavailable(true);
        } else {
          const latest = toDraft(visible.communication);
          setAssignmentDenied(true);
          setBaseline(visible.communication);
          setDraft(
            rebaseDraft(latest, proposed, {
              ...changes,
              ownerUserId: undefined,
            })
          );
        }
        setError(failure.message);
        return;
      }
      setConflict(null);
      setBaseline(current);
      setDraft(proposed);
      setError(
        failure instanceof Error
          ? failure.message
          : "沟通记录保存失败，请重试。"
      );
    } finally {
      unsubscribe();
      saving.current = false;
      setPending(false);
    }
  }

  function cancelConflict() {
    if (!conflict) return;
    // 再次保存时使用服务端最新版本，成功后由后端给版本加一。
    setBaseline(conflict.current);
    setDraft(conflict.draft);
    setConflict(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cannotSave) return;
    if (!draft.title.trim() || !draft.summary.trim()) {
      setError("请填写沟通主题和初次沟通内容。");
      return;
    }
    void save(draft);
  }

  if (unavailable) {
    return (
      <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="text-xl font-semibold">无法查看此沟通记录</h1>
        <FieldError>{error}</FieldError>
        <Button variant="outline" onClick={onUnavailable ?? onCancel}>
          返回沟通列表
        </Button>
      </main>
    );
  }

  if (saved && (isEdit || attachments.communicationIssue)) {
    return (
      <SavedAttachmentUploads
        communicationId={saved.id}
        queue={attachments}
        recordSaved={saved.recordSaved}
        error={error}
        onView={() => void onSaved(saved.id)}
        onUnavailable={onUnavailable ?? onCancel}
      />
    );
  }

  return (
    <main className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form onSubmit={submit} className="space-y-5">
        <div className={formHeaderLayout}>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? "编辑沟通记录" : "新建沟通记录"}
          </h1>
          {savedCreationId ? (
            <Button
              type="button"
              className="h-10 px-4"
              disabled={attachmentBusy}
              onClick={() => void onSaved(savedCreationId)}
            >
              查看沟通详情
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className={archiveInProgress ? "h-10 px-4" : undefined}
                disabled={pending}
                onClick={onCancel}
              >
                {archiveInProgress ? "返回沟通详情" : "取消"}
              </Button>
              <Button
                type="submit"
                className={archiveInProgress ? "h-10 gap-2 px-4" : undefined}
                aria-busy={pending}
                disabled={cannotSave}
              >
                <SubmitIcon aria-hidden="true" />
                {pending ? "正在保存…" : isEdit ? "完成" : "保存"}
              </Button>
            </div>
          )}
        </div>

        {error ? (
          <FieldError className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
            {error}
          </FieldError>
        ) : null}

        <div className={formFieldsLayout}>
          <Field className="min-w-0">
            <FieldLabel htmlFor="communication-form-title">主题</FieldLabel>
            <Input
              id="communication-form-title"
              ref={titleRef}
              required
              maxLength={128}
              disabled={fieldsLocked}
              value={draft.title}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          <CustomerSelectField
            value={customerChoice}
            locked={isEdit || Boolean(initialCustomer)}
            disabled={fieldsLocked}
            controlClassName="h-8 shadow-none"
            onChange={(selection) => {
              if (selection?.id === customer?.id) return;
              setCustomer(selection);
              setError("");
              setDraft((previous) => ({ ...previous, owner: defaultOwner }));
            }}
          />
          <TagMultiSelectField
            id="communication-form-tags"
            label="标签"
            value={draft.tags}
            onChange={(tags) => setDraft((previous) => ({ ...previous, tags }))}
            disabled={fieldsLocked}
            onCreatingChange={setTagPending}
            loadTags={listCommunicationTags}
            createTag={createCommunicationTag}
            updateTagColor={
              viewer.role === "company-admin"
                ? updateCommunicationTagColor
                : undefined
            }
            tagLimitLabel="每条沟通"
          />
          <CommunicationOwnerField
            customerId={customerId}
            editable={canChangeOwner && !savedCreationId}
            value={draft.owner}
            disabled={fieldsLocked}
            onChange={(owner) =>
              setDraft((previous) => ({ ...previous, owner }))
            }
          />
          <Field className="min-w-0 md:col-span-2">
            <FieldLabel htmlFor="communication-form-summary">
              初次沟通内容
            </FieldLabel>
            <Textarea
              id="communication-form-summary"
              className="min-h-36 shadow-xs"
              required
              maxLength={20_000}
              disabled={fieldsLocked}
              value={draft.summary}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  summary: event.target.value,
                }))
              }
            />
          </Field>
        </div>
        <Field>
          <FieldTitle>附件</FieldTitle>
          {savedCreationId ? (
            <>
              <p className="text-sm">沟通记录已保存。</p>
              <SavedAttachmentUploadStatus queue={attachments} />
            </>
          ) : (
            <AttachmentDropZone
              accept={attachmentAccept}
              disabled={attachmentBusy}
              onFilesSelected={attachments.add}
            />
          )}
          <AttachmentQueue
            items={attachments.items}
            disabled={attachmentBusy}
            onRetry={
              savedCreationId
                ? (id) => void attachments.upload(savedCreationId, id)
                : undefined
            }
            onRemove={(id) => void attachments.remove(id, savedCreationId)}
          />
        </Field>
      </form>

      <VersionConflictDialog
        differences={
          conflict
            ? getDifferences(toDraft(conflict.current), conflict.draft)
            : null
        }
        description="沟通记录有更新。确认覆盖只会提交你的修改，取消会保留草稿和最新版本。"
        pending={pending}
        onCancel={cancelConflict}
        onOverwrite={() => {
          if (conflict) void save(conflict.draft, conflict.current);
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
    </main>
  );
}
