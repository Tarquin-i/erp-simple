import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Check, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { VersionConflictDialog } from "@/components/customers/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomer,
  CustomerApiError,
  listAssignableCustomerOwners,
  updateCustomer,
} from "@/request/customers";
import type { Department } from "@/request/organization";
import type {
  Customer,
  CustomerChannel,
  CustomerOwner,
  CustomerWriteInput,
} from "@/request/customers";

import {
  CustomerChannelPicker,
  CustomerTagPicker,
} from "./channel-tag-pickers";
import type { CustomerFormOption } from "./channel-tag-pickers";
import { readListQueryFromState } from "./list-query";

type Draft = {
  companyName: string;
  remark: string;
  owner: CustomerOwner | undefined;
  channels: CustomerFormOption[];
  tags: CustomerFormOption[];
};

type DepartmentRoster = { departmentId: string } & (
  | { owners: CustomerOwner[]; error?: never }
  | { owners?: never; error: string }
);

function customerDraft(
  customer: Customer | undefined,
  owner?: CustomerOwner
): Draft {
  return {
    companyName: customer?.companyName ?? "",
    remark: customer?.remark ?? "",
    owner,
    channels:
      customer?.channels.map(({ code, name }) => ({ id: code, name })) ?? [],
    tags: customer?.tags.map(({ id, name }) => ({ id, name })) ?? [],
  };
}

function optionIds(options: CustomerFormOption[]) {
  return options.map(({ id }) => id);
}

function sameOptions(
  before: CustomerFormOption[],
  after: CustomerFormOption[]
) {
  if (before.length !== after.length) return false;
  const previous = new Set(optionIds(before));
  return after.every(({ id }) => previous.has(id));
}

function getChangedFields(initial: Draft, draft: Draft): CustomerWriteInput {
  const companyName = draft.companyName.trim();
  const remark = draft.remark.trim();

  return {
    ...(companyName !== initial.companyName.trim() ? { companyName } : {}),
    ...(remark !== initial.remark.trim() ? { remark: remark || null } : {}),
    ...(draft.owner && draft.owner.id !== initial.owner?.id
      ? { ownerUserId: draft.owner.id }
      : {}),
    ...(!sameOptions(initial.channels, draft.channels)
      ? { channelCodes: optionIds(draft.channels) }
      : {}),
    ...(!sameOptions(initial.tags, draft.tags)
      ? { tagIds: optionIds(draft.tags) }
      : {}),
  };
}

function isCustomerSnapshot(value: unknown, id: string): value is Customer {
  if (!value || typeof value !== "object") return false;
  const current = value as Partial<Customer>;
  return (
    current.id === id &&
    typeof current.version === "number" &&
    typeof current.companyName === "string" &&
    typeof current.ownerUserId === "string" &&
    typeof current.ownerName === "string" &&
    Array.isArray(current.channels) &&
    Array.isArray(current.tags)
  );
}

function conflictDifferences(
  current: Customer,
  changes: CustomerWriteInput,
  initial: Draft,
  draft: Draft
) {
  const latest = customerDraft(current, {
    id: current.ownerUserId,
    name: current.ownerName,
  });
  const differences = [];
  const preserve = "保留当前资料";
  const names = (options: CustomerFormOption[]) =>
    options.map(({ name }) => name).join("、") || "无";

  if (
    changes.companyName !== undefined ||
    latest.companyName !== initial.companyName
  ) {
    differences.push({
      label: "客户名称",
      current: latest.companyName,
      proposed: changes.companyName ?? preserve,
    });
  }
  if (
    changes.channelCodes !== undefined ||
    !sameOptions(initial.channels, latest.channels)
  ) {
    differences.push({
      label: "渠道",
      current: names(latest.channels),
      proposed:
        changes.channelCodes === undefined ? preserve : names(draft.channels),
    });
  }
  if (changes.tagIds !== undefined || !sameOptions(initial.tags, latest.tags)) {
    differences.push({
      label: "标签",
      current: names(latest.tags),
      proposed: changes.tagIds === undefined ? preserve : names(draft.tags),
    });
  }
  if (
    changes.ownerUserId !== undefined ||
    current.ownerUserId !== initial.owner?.id
  ) {
    differences.push({
      label: "业务员",
      current: current.ownerName,
      proposed:
        changes.ownerUserId === undefined
          ? preserve
          : (draft.owner?.name ?? "无"),
    });
  }
  if (changes.remark !== undefined || latest.remark !== initial.remark) {
    differences.push({
      label: "备注",
      current: latest.remark || "无",
      proposed:
        changes.remark === undefined ? preserve : changes.remark || "无",
    });
  }

  return differences;
}

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
  const [ownerLookup, setOwnerLookup] = useState<DepartmentRoster>();
  const [rosterRetry, setRosterRetry] = useState(0);
  const [conflict, setConflict] = useState<{
    current: Customer;
    changes: CustomerWriteInput;
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const changes = getChangedFields(initial, draft);
  const isEdit = customer !== undefined;
  const busy = pending || tagPending;
  const currentOwnerLookup =
    ownerLookup?.departmentId === departmentId ? ownerLookup : undefined;
  const loadingOwners = Boolean(departmentId && !currentOwnerLookup);
  const ownerOptions = departments
    ? (currentOwnerLookup?.owners ?? [])
    : assignableOwners;
  const missingAssignment = Boolean(
    departments && (!departmentId || !draft.owner)
  );
  const ownerPlaceholder = !departmentId
    ? "请先选择部门"
    : loadingOwners
      ? "正在加载业务员…"
      : currentOwnerLookup?.error
        ? "无法加载业务员"
        : ownerOptions?.length
          ? "请选择业务员"
          : "该部门暂无可选业务员";
  const SubmitIcon = isEdit ? Save : Check;
  const submitLabel = isEdit ? "保存" : "完成";

  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    const { signal } = controller;

    listAssignableCustomerOwners(undefined, signal, departmentId)
      .then(({ owners }) => {
        if (!signal.aborted) setOwnerLookup({ departmentId, owners });
      })
      .catch((failure: unknown) => {
        if (signal.aborted) return;
        setOwnerLookup({
          departmentId,
          error: failure instanceof Error ? failure.message : "请稍后重试。",
        });
      });

    return () => controller.abort();
  }, [departmentId, rosterRetry]);

  function setNameValidation(message: string) {
    setNameError(message);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  async function save(
    payload: CustomerWriteInput,
    expectedVersion = originalVersion
  ) {
    if (saving.current || tagPending) return;
    saving.current = true;
    setPending(true);
    setError("");
    setNameError("");

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
    if (
      busy ||
      missingAssignment ||
      (isEdit && Object.keys(changes).length === 0)
    )
      return;
    if (!draft.companyName.trim()) {
      setNameValidation("请填写客户名称。");
      return;
    }

    void save(changes);
  }

  return (
    <main className="flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form onSubmit={submit} className="space-y-5">
        <div
          className={`flex flex-wrap justify-between gap-4 ${isEdit ? "items-start" : "items-center"}`}
        >
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {customer?.companyName ?? "新建客户"}
            </h1>
            {isEdit && (
              <p className="text-sm text-muted-foreground">编辑客户</p>
            )}
          </div>
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
              disabled={
                busy ||
                missingAssignment ||
                (isEdit && Object.keys(changes).length === 0)
              }
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
          <Field
            data-invalid={Boolean(nameError)}
            className={isEdit ? "min-w-0 md:col-span-2" : "min-w-0"}
          >
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

          {departments && (
            <Field className="min-w-0">
              <FieldLabel htmlFor="customer-form-department">部门</FieldLabel>
              <Select
                required
                disabled={pending || !departments.length}
                value={departmentId}
                onValueChange={(id) => {
                  if (id === departmentId) return;
                  setDepartmentId(id);
                  setOwnerLookup(undefined);
                  setNameError("");
                  setError("");
                  setDraft((current) => ({ ...current, owner: undefined }));
                }}
              >
                <SelectTrigger
                  id="customer-form-department"
                  className="w-full shadow-xs data-[size=default]:h-10"
                >
                  <SelectValue
                    placeholder={
                      departments.length ? "请选择部门" : "暂无可选部门"
                    }
                  />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {departments.map(({ id, name }) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field className="min-w-0">
            <FieldLabel htmlFor="customer-form-owner">业务员</FieldLabel>
            {ownerOptions ? (
              <Select
                required={Boolean(departments)}
                disabled={pending || !ownerOptions.length}
                value={draft.owner?.id ?? ""}
                onValueChange={(id) => {
                  const selected = ownerOptions.find(
                    (owner) => owner.id === id
                  );
                  if (selected) {
                    setDraft((current) => ({ ...current, owner: selected }));
                  }
                }}
              >
                <SelectTrigger
                  id="customer-form-owner"
                  aria-busy={loadingOwners}
                  className="w-full shadow-xs data-[size=default]:h-10"
                >
                  <SelectValue placeholder={ownerPlaceholder}>
                    {draft.owner?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {ownerOptions.map(({ id, name }) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="customer-form-owner"
                className="h-10 bg-muted/25 text-muted-foreground shadow-xs"
                readOnly
                value={draft.owner?.name ?? ""}
              />
            )}
            {currentOwnerLookup?.error && (
              <div className="flex items-center gap-2">
                <FieldError>{currentOwnerLookup.error}</FieldError>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="重试加载业务员"
                  onClick={() => {
                    setOwnerLookup(undefined);
                    setRosterRetry((current) => current + 1);
                  }}
                >
                  重试
                </Button>
              </div>
            )}
          </Field>
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
