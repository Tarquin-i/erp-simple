import {
  Link,
  useLocation,
  useMatch,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { Check, Save } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  FixedMultiSelectField,
  TagMultiSelectField,
} from "@/components/shared/multi-select-fields";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createUuid } from "@/lib/uuid";
import {
  createCustomer,
  createCustomerTag,
  CustomerApiError,
  listCustomerTags,
  updateCustomer,
  deleteCustomerTag,
  getCustomerTagUsage,
  updateCustomerTag,
} from "@/request/customers";
import type { Department } from "@/request/organization";
import type {
  Customer,
  CustomerChannel,
  CustomerOwner,
  CustomerWriteInput,
} from "@/request/customers";

import { CustomerChannelIcon } from "../channel-icon";
import { readListQueryFromState } from "../list-query";
import { conflictDifferences, isCustomerSnapshot } from "./edit-conflict";
import { customerDraft, getChangedFields } from "./form-payload";
import type { Draft } from "./form-payload";
import { CustomerOwnerFields } from "./owner-fields";

type CustomerFormBaseline = { customer?: Customer; draft: Draft };
type SaveAction = "save" | "restore";

/**
 * 渲染新建和编辑共用的客户表单，并处理保存与版本冲突。
 * @param props `customer` 有值时进入编辑模式，省略时新建。`owner` 提供初始业务员，`assignableOwners` 提供可选名单。
 * `departments` 供管理员新建时选部门，`channels` 提供渠道选项，`onCancel` 和 `onSaved` 由路由决定页面去向。
 * @returns 客户表单及版本冲突弹窗，保存失败时在表单中显示错误。
 */
export function CustomerForm({
  customer,
  owner,
  assignableOwners,
  departments,
  channels,
  onCancel,
  onSaved,
}: {
  customer?: Customer;
  owner?: CustomerOwner;
  assignableOwners?: CustomerOwner[];
  departments?: Department[];
  channels: CustomerChannel[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const { viewer } = useRouteContext({ from: "/_protected" });
  // 初始表单值用于判断用户改过的字段，写回旧值后也不替换表单里的草稿。
  const [openedDraft] = useState(() => customerDraft(customer, owner));
  const [baseline, setBaseline] = useState<CustomerFormBaseline>(() => ({
    customer,
    draft: openedDraft,
  }));
  const [draft, setDraft] = useState(openedDraft);
  const [savingAction, setSavingAction] = useState<SaveAction>();
  const [restored, setRestored] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const [tagPending, setTagPending] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const tagDepartmentId =
    customer?.departmentId || departmentId || viewer.department?.id;
  const [conflict, setConflict] = useState<{
    current: Customer;
    changes: CustomerWriteInput;
    previousDraft: Draft;
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const creation = useRef<{ id: string; signature: string } | null>(null);
  const changes = getChangedFields(openedDraft, draft);
  const isEdit = customer !== undefined;
  const pending = savingAction !== undefined;
  const busy = pending || tagPending;
  const missingAssignment = Boolean(
    departments && (!departmentId || !draft.owner)
  );
  const canSubmit =
    !busy && !missingAssignment && (!isEdit || Object.keys(changes).length > 0);
  const SubmitIcon = isEdit ? Save : Check;
  const submitLabel = isEdit ? "保存" : "完成";
  const formError = nameError || error;

  function setNameValidation(message: string) {
    setError("");
    setNameError(message);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  /**
   * 新建、保存或写回客户资料。成功写回时保留输入，只更新下次的版本基准。
   * @param payload 本次提交的变更字段或需写回的旧值。
   * @param versionFrom 编辑时使用的客户快照，默认取当前表单的基准。
   * @param action 普通保存或仅写回旧值，后者与草稿提交分别校验版本。
   * @returns 处理结束后完成，无业务数据。版本冲突继续保留草稿并展示差异。
   */
  async function save(
    payload: CustomerWriteInput,
    versionFrom = baseline,
    action: SaveAction = "save"
  ) {
    if (saving.current || tagPending) return;
    saving.current = true;
    setSavingAction(action);
    setError("");
    setNameError("");

    // 保存途中若路由已切换，响应到达后不再触发跳转或打开错误弹窗。
    let leftForm = false;
    let savedDraft = false;
    const unsubscribe = router.history.subscribe(() => {
      leftForm = true;
    });

    try {
      if (customer) {
        const expectedVersion = versionFrom.customer?.version;
        if (expectedVersion === undefined) {
          throw new Error("无法确认客户资料版本，请刷新后重试。");
        }
        const { customer: saved } = await updateCustomer(customer.id, {
          ...payload,
          expectedVersion,
        });
        if (leftForm) return;
        if (action === "restore") {
          setBaseline({ customer: saved, draft: customerDraft(saved) });
          setRestored(true);
          setConflict(null);
          return;
        }
      } else {
        const input = {
          ...payload,
          companyName: draft.companyName.trim(),
          ...(departmentId ? { departmentId } : {}),
        };
        const signature = JSON.stringify(input);
        if (creation.current?.signature !== signature) {
          creation.current = { id: createUuid(), signature };
        }
        await createCustomer(input, creation.current.id);
      }
      if (leftForm) return;
      savedDraft = true;
      setConflict(null);
      await onSaved();
    } catch (failure) {
      if (leftForm) return;
      if (savedDraft) {
        setDraft(openedDraft);
        setTerminalError("资料已保存。页面跳转失败，请返回查看。");
        return;
      }
      if (
        failure instanceof CustomerApiError &&
        failure.code === "version_conflict" &&
        customer &&
        isCustomerSnapshot(failure.current, customer.id)
      ) {
        setConflict({
          current: failure.current,
          changes: action === "restore" ? changes : payload,
          previousDraft: versionFrom.draft,
        });
        return;
      }
      setConflict(null);
      const message =
        failure instanceof Error ? failure.message : "保存失败，请重试。";
      if (restored || action === "restore") {
        setDraft(openedDraft);
        const restoreStatus = restored
          ? "此前写回的旧值已保存。"
          : "未确认旧值写回成功，请返回查看最新资料。";
        setTerminalError(`${message}${restoreStatus}未保存的草稿已丢弃。`);
      } else if (
        failure instanceof CustomerApiError &&
        failure.code === "duplicate_customer"
      ) {
        setNameValidation(`${message}请修改客户名称后重试。`);
      } else if (
        !isEdit &&
        (failure instanceof TypeError ||
          failure instanceof SyntaxError ||
          (failure instanceof CustomerApiError &&
            (failure.status === 408 || failure.status >= 500)))
      ) {
        setError(
          "暂未确认客户是否已创建。请保留当前资料，再次点击「完成」确认结果。"
        );
      } else {
        setError(message);
      }
      return;
    } finally {
      unsubscribe();
      saving.current = false;
      setSavingAction(undefined);
    }
  }

  function restoreOldValues() {
    if (!conflict) return;
    const latest = customerDraft(conflict.current);
    const { ownerUserId, ...oldValues } = getChangedFields(latest, openedDraft);
    void save(
      {
        ...oldValues,
        // 即使当前值已相同，显式写回也要进行一次版本校验并产生新版本。
        companyName: openedDraft.companyName,
        ...(assignableOwners && ownerUserId !== undefined
          ? { ownerUserId }
          : {}),
      },
      { customer: conflict.current, draft: latest },
      "restore"
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    if (!draft.companyName.trim()) {
      setNameValidation("请填写客户名称。");
      return;
    }
    void save(changes);
  }

  if (terminalError) {
    return (
      <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="text-xl font-semibold">本次编辑已结束</h1>
        <FieldError>{terminalError}</FieldError>
        <Button type="button" variant="outline" onClick={onCancel}>
          {isEdit ? "返回客户详情" : "返回客户列表"}
        </Button>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-break-word">
            {isEdit ? "编辑客户" : "新建客户"}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button type="submit" aria-busy={pending} disabled={!canSubmit}>
              <SubmitIcon aria-hidden="true" />
              {pending ? "正在保存…" : submitLabel}
            </Button>
          </div>
        </div>

        {formError ? (
          <FieldError
            id={nameError ? "customer-form-name-error" : undefined}
            className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2"
          >
            {formError}
          </FieldError>
        ) : null}
        {restored && (
          <p className="text-sm text-muted-foreground" role="status">
            已写回旧值，草稿尚未保存。
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(nameError)} className="min-w-0">
            <FieldLabel htmlFor="customer-form-name">客户名称</FieldLabel>
            <Input
              id="customer-form-name"
              ref={nameRef}
              name="companyName"
              placeholder="请输入客户名称"
              maxLength={256}
              aria-required="true"
              aria-invalid={Boolean(nameError)}
              aria-describedby={
                nameError ? "customer-form-name-error" : undefined
              }
              disabled={pending}
              value={draft.companyName}
              onChange={(event) => {
                setNameError("");
                setDraft((current) => ({
                  ...current,
                  companyName: event.target.value,
                }));
              }}
            />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor="customer-form-number">客户编号</FieldLabel>
            <Input
              id="customer-form-number"
              className="bg-muted/25 text-muted-foreground"
              readOnly
              value={customer?.customerNo ?? ""}
              placeholder="保存后自动生成"
            />
          </Field>

          <FixedMultiSelectField
            id="customer-form-channels"
            label="渠道"
            renderOptionIcon={({ id }) => <CustomerChannelIcon code={id} />}
            chipSize="md"
            emptyMessage="暂无渠道"
            value={draft.channels}
            items={channels.map(({ code, name }) => ({ id: code, name }))}
            onChange={(value) =>
              setDraft((current) => ({ ...current, channels: value }))
            }
            disabled={pending}
          />
          <TagMultiSelectField
            key={tagDepartmentId}
            id="customer-form-tags"
            label="标签"
            chipSize="md"
            departmentId={tagDepartmentId}
            placeholder={tagDepartmentId ? undefined : "请先选择部门"}
            value={draft.tags}
            onChange={(value) =>
              setDraft((current) => ({ ...current, tags: value }))
            }
            onCreatingChange={setTagPending}
            loadTags={listCustomerTags}
            createTag={createCustomerTag}
            manageTags={{
              update: updateCustomerTag,
              usage: getCustomerTagUsage,
              remove: deleteCustomerTag,
            }}
            tagLimitLabel="每个客户"
            disabled={pending}
          />

          <CustomerOwnerFields
            departments={departments}
            departmentId={departmentId}
            onDepartmentChange={(id) => {
              // 业务员和标签随目标部门切换重新选择。
              setDepartmentId(id);
              setNameError("");
              setError("");
              setDraft((current) => ({
                ...current,
                owner: undefined,
                tags: [],
              }));
            }}
            owner={draft.owner}
            assignableOwners={assignableOwners}
            onOwnerChange={(owner) =>
              setDraft((current) => ({ ...current, owner }))
            }
            disabled={pending}
          />
          <Field className="min-w-0 sm:col-span-2">
            <FieldLabel htmlFor="customer-form-remark">备注</FieldLabel>
            <Textarea
              id="customer-form-remark"
              className="min-h-36 resize-y shadow-xs"
              placeholder="填写备注"
              maxLength={4096}
              disabled={pending}
              value={draft.remark}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
            />
          </Field>
        </div>
      </form>
      <VersionConflictDialog
        differences={
          conflict
            ? conflictDifferences(
                conflict.current,
                conflict.changes,
                conflict.previousDraft,
                draft
              )
            : null
        }
        pending={pending}
        pendingLabel={savingAction === "restore" ? "正在写回旧值…" : undefined}
        onCancel={() => setConflict(null)}
        onRestore={restoreOldValues}
        onOverwrite={() => {
          // 用刚对比过的服务端版本重试，仅提交本次修改的字段。
          if (conflict)
            void save(conflict.changes, {
              customer: conflict.current,
              draft: customerDraft(conflict.current),
            });
        }}
      />
    </main>
  );
}

export function CustomerFormPending() {
  const isCreate = useMatch({
    strict: false,
    select: ({ routeId }) => routeId === "/_protected/customers/new",
  });
  const role = useRouteContext({
    from: "/_protected",
    select: ({ viewer }) => viewer.role,
  });
  const fields = [
    "name",
    "number",
    "channels",
    "tags",
    ...(isCreate && role === "company-admin" ? ["department"] : []),
    "owner",
  ];

  return (
    <main
      className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
      aria-busy="true"
      aria-label="正在加载客户表单"
    >
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-12.5 rounded-lg" />
          <Skeleton className="h-8 w-18 rounded-lg" />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field} className="grid gap-2">
            <Skeleton className="h-[1.375em] w-14 text-sm" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
        <div className="grid gap-2 sm:col-span-2">
          <Skeleton className="h-[1.375em] w-8 text-sm" />
          <Skeleton className="h-36 w-full" />
        </div>
      </div>
    </main>
  );
}

export function CustomerFormLoadError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  const customerListQuery = useLocation({
    select: (location) => readListQueryFromState(location.state),
  });
  return (
    <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <h1 className="text-xl font-semibold">无法加载客户表单</h1>
      <FieldError>
        {error instanceof Error ? error.message : "请稍后重试。"}
      </FieldError>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          重试
        </Button>
        <Button asChild variant="outline">
          <Link to="/customers" search={customerListQuery} replace>
            返回客户列表
          </Link>
        </Button>
      </div>
    </main>
  );
}
