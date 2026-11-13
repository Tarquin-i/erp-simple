import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Check, Save } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomer,
  CustomerApiError,
  updateCustomer,
} from "@/request/customers";
import type { Department } from "@/request/organization";
import type {
  Customer,
  CustomerChannel,
  CustomerOwner,
  CustomerWriteInput,
} from "@/request/customers";

import { readListQueryFromState } from "../list-query";
import { VersionConflictDialog } from "../version-conflict-dialog";
import {
  CustomerChannelPicker,
  CustomerTagPicker,
} from "./channel-tag-selectors";
import { conflictDifferences, isCustomerSnapshot } from "./edit-conflict";
import { customerDraft, getChangedFields } from "./form-payload";
import { CustomerOwnerFields } from "./owner-fields";

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
  const [initial] = useState(() => customerDraft(customer, owner));
  const [draft, setDraft] = useState(initial);
  const [originalVersion] = useState(customer?.version);
  const [pending, setPending] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [conflict, setConflict] = useState<{
    current: Customer;
    changes: CustomerWriteInput;
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const changes = getChangedFields(initial, draft);
  const isEdit = customer !== undefined;
  const busy = pending || tagPending;
  const missingAssignment = Boolean(
    departments && (!departmentId || !draft.owner)
  );
  const canSubmit =
    !busy && !missingAssignment && (!isEdit || Object.keys(changes).length > 0);
  const SubmitIcon = isEdit ? Save : Check;
  const submitLabel = isEdit ? "保存" : "完成";

  function setNameValidation(message: string) {
    setNameError(message);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  /**
   * 新建或更新客户，成功后调用页面提供的保存回调。
   * @param payload 本次提交的表单变更字段。
   * @param expectedVersion 编辑时使用的客户版本，默认取打开表单时的版本。
   * @returns 处理结束后完成，无业务数据。重名提示显示在名称字段，版本冲突交给对比弹窗处理。
   */
  async function save(
    payload: CustomerWriteInput,
    expectedVersion = originalVersion
  ) {
    if (saving.current || tagPending) return;
    saving.current = true;
    setPending(true);
    setError("");
    setNameError("");

    // 保存途中若路由已切换，响应到达后不再触发跳转或打开错误弹窗。
    let leftForm = false;
    const unsubscribe = router.history.subscribe(() => {
      leftForm = true;
    });

    try {
      if (customer) {
        if (expectedVersion === undefined) {
          throw new Error("无法确认客户资料版本，请刷新后重试。");
        }
        await updateCustomer(customer.id, { ...payload, expectedVersion });
      } else {
        await createCustomer({
          ...payload,
          companyName: draft.companyName.trim(),
          ...(departmentId ? { departmentId } : {}),
        });
      }
      if (leftForm) return;
      setConflict(null);
      await onSaved();
    } catch (failure) {
      if (leftForm) return;
      if (failure instanceof CustomerApiError) {
        if (failure.code === "duplicate_customer") {
          setConflict(null);
          setNameValidation(`${failure.message}请修改客户名称后重试。`);
          return;
        }
        if (
          failure.code === "version_conflict" &&
          customer &&
          isCustomerSnapshot(failure.current, customer.id)
        ) {
          setConflict({ current: failure.current, changes: payload });
          return;
        }
      }
      setConflict(null);
      setError(
        failure instanceof Error ? failure.message : "保存失败，请重试。"
      );
    } finally {
      unsubscribe();
      saving.current = false;
      setPending(false);
    }
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

  return (
    <main className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            {isEdit ? "编辑客户" : "新建客户"}
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
              disabled={!canSubmit}
            >
              <SubmitIcon aria-hidden="true" />
              {pending ? "正在保存…" : submitLabel}
            </Button>
          </div>
        </div>

        {error ? (
          <FieldError className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
            {error}
          </FieldError>
        ) : null}

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          <Field data-invalid={Boolean(nameError)} className="min-w-0">
            <FieldLabel htmlFor="customer-form-name">客户名称</FieldLabel>
            <Input
              id="customer-form-name"
              ref={nameRef}
              name="companyName"
              className="h-10 shadow-xs"
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
            {nameError ? (
              <FieldError id="customer-form-name-error">{nameError}</FieldError>
            ) : null}
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor="customer-form-number">客户编号</FieldLabel>
            <Input
              id="customer-form-number"
              className="h-10 bg-muted/25 text-muted-foreground shadow-xs"
              readOnly
              value={customer?.customerNo ?? ""}
              placeholder="保存后自动生成"
            />
          </Field>

          <CustomerChannelPicker
            id="customer-form-channels"
            label="渠道"
            value={draft.channels}
            items={channels.map(({ code, name }) => ({ id: code, name }))}
            onChange={(value) =>
              setDraft((current) => ({ ...current, channels: value }))
            }
            disabled={pending}
          />
          <CustomerTagPicker
            id="customer-form-tags"
            label="标签"
            value={draft.tags}
            onChange={(value) =>
              setDraft((current) => ({ ...current, tags: value }))
            }
            allowCreate
            onCreatingChange={setTagPending}
            disabled={pending}
          />

          <CustomerOwnerFields
            departments={departments}
            departmentId={departmentId}
            onDepartmentChange={(id) => {
              // 新部门的业务员需要重新选择，旧部门的人选随部门切换清除。
              setDepartmentId(id);
              setNameError("");
              setError("");
              setDraft((current) => ({ ...current, owner: undefined }));
            }}
            owner={draft.owner}
            assignableOwners={assignableOwners}
            onOwnerChange={(owner) =>
              setDraft((current) => ({ ...current, owner }))
            }
            disabled={pending}
          />
          <Field className="min-w-0 md:col-span-2">
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
                initial,
                draft
              )
            : null
        }
        pending={pending}
        onCancel={() => setConflict(null)}
        onOverwrite={() => {
          // 用刚对比过的服务端版本重试，仅提交本次修改的字段。
          if (conflict) void save(conflict.changes, conflict.current.version);
        }}
      />
    </main>
  );
}

export function CustomerFormPending() {
  return (
    <main
      className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8"
      aria-busy="true"
      aria-label="正在加载客户表单"
    >
      <Skeleton className="mb-6 h-7 w-28" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
        <Skeleton className="h-36 md:col-span-2" />
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
