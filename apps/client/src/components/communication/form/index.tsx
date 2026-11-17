import { useRouter } from "@tanstack/react-router";
import { Check, Save } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { CustomerTagPicker } from "@/components/customers/form/channel-tag-selectors";
import { VersionConflictDialog } from "@/components/customers/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CommunicationApiError,
  createCommunication,
  createCommunicationTag,
  getCommunication,
  isCommunicationSnapshot,
  listCommunicationTags,
  updateCommunication,
} from "@/request/communication";
import type { Communication } from "@/request/communication";
import type { Viewer } from "@/request/organization";

import { CommunicationCustomerField } from "./customer-field";
import type { CustomerChoice } from "./customer-field";
import { getChanges, getDifferences, rebaseDraft, toDraft } from "./draft";
import type { CommunicationDraft } from "./draft";
import { CommunicationOwnerField } from "./owner-field";

type Conflict = { current: Communication; draft: CommunicationDraft };

export function CommunicationFormPending() {
  return (
    <main
      className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
      aria-busy="true"
      aria-label="正在加载沟通表单"
    >
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-36" />
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
  initialCustomer,
  viewer,
  onCancel,
  onUnavailable,
  onSaved,
}: {
  record?: Communication;
  initialCustomer?: CustomerChoice;
  viewer: Viewer;
  onCancel: () => void;
  onUnavailable?: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const isAdmin = viewer.role === "company-admin";
  const canAssign = isAdmin || viewer.role === "supervisor";
  const defaultOwner = isAdmin
    ? undefined
    : { id: viewer.account.id, name: viewer.account.name };
  const [baseline, setBaseline] = useState(record);
  const [draft, setDraft] = useState(() => toDraft(record, defaultOwner));
  const [customer, setCustomer] = useState<CustomerChoice | null>(
    initialCustomer ?? null
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, setPending] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [assignmentDenied, setAssignmentDenied] = useState(false);
  const saving = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(record);
  const customerChoice = baseline ? baseline.customer : customer;
  const customerId = baseline?.customerId ?? customer?.id;
  const canChangeOwner =
    canAssign && !assignmentDenied && (!baseline || baseline.canViewCustomer);
  const hasChanges =
    Object.keys(getChanges(toDraft(baseline), draft)).length > 0;
  const cannotSave =
    pending ||
    tagPending ||
    (isEdit ? !hasChanges : !customerId || (isAdmin && !draft.owner));
  const SubmitIcon = isEdit ? Check : Save;

  async function save(proposed: CommunicationDraft, current = baseline) {
    if (saving.current || tagPending || !customerId) return;
    saving.current = true;
    setPending(true);
    setError("");

    let leftForm = false;
    const unsubscribe = router.history.subscribe(() => {
      leftForm = true;
    });
    const changes = getChanges(toDraft(current), proposed);
    try {
      let savedId: string;
      if (current) {
        savedId = current.id;
        if (Object.keys(changes).length) {
          await updateCommunication(current.id, {
            ...changes,
            expectedVersion: current.version,
          });
        }
      } else {
        const { communication } = await createCommunication({
          customerId,
          title: proposed.title.trim(),
          summary: proposed.summary.trim(),
          tagIds: proposed.tags.map(({ id }) => id),
          ownerUserId: canAssign ? proposed.owner?.id : undefined,
        });
        savedId = communication.id;
      }
      if (!leftForm) {
        setConflict(null);
        await onSaved(savedId);
      }
    } catch (failure) {
      if (leftForm) return;
      if (
        current &&
        failure instanceof CommunicationApiError &&
        failure.code === "version_conflict" &&
        isCommunicationSnapshot(failure.current, current.id)
      ) {
        const latest = toDraft(failure.current);
        const rebased = rebaseDraft(latest, proposed, changes);
        if (!Object.keys(getChanges(latest, rebased)).length) {
          setConflict(null);
          await onSaved(current.id);
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

  return (
    <main className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? "编辑沟通记录" : "新建沟通记录"}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              disabled={pending}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-10 gap-2 px-4"
              aria-busy={pending}
              disabled={cannotSave}
            >
              <SubmitIcon aria-hidden="true" />
              {pending ? "正在保存…" : isEdit ? "完成" : "保存"}
            </Button>
          </div>
        </div>

        {error ? (
          <FieldError className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
            {error}
          </FieldError>
        ) : null}

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          <Field className="min-w-0">
            <FieldLabel htmlFor="communication-form-title">主题</FieldLabel>
            <Input
              id="communication-form-title"
              ref={titleRef}
              className="h-10 shadow-xs"
              required
              maxLength={128}
              disabled={pending}
              value={draft.title}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          <CommunicationCustomerField
            value={customerChoice}
            locked={isEdit || Boolean(initialCustomer)}
            disabled={pending}
            onChange={(selection) => {
              if (selection?.id === customer?.id) return;
              setCustomer(selection);
              setError("");
              setDraft((previous) => ({ ...previous, owner: defaultOwner }));
            }}
          />
          <CustomerTagPicker
            id="communication-form-tags"
            label="标签"
            value={draft.tags}
            onChange={(tags) => setDraft((previous) => ({ ...previous, tags }))}
            disabled={pending}
            allowCreate
            onCreatingChange={setTagPending}
            loadTags={listCommunicationTags}
            createTag={createCommunicationTag}
            tagLimitLabel="每条沟通"
          />
          <CommunicationOwnerField
            customerId={customerId}
            editable={canChangeOwner}
            value={draft.owner}
            disabled={pending}
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
              disabled={pending}
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
