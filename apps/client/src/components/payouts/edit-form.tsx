import { useRouter } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import { toastManager } from "@/components/shared/toast";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPayoutQuantity } from "@/lib/payouts";
import {
  isConfirmedPayoutError,
  isPayoutSnapshot,
  PayoutApiError,
  updatePayout,
} from "@/request/payouts";
import type { PayoutDetailRecord } from "@/request/payouts";

type PayoutBasics = Pick<PayoutDetailRecord, "name" | "unitPrice" | "remark">;
type EditPatch = Partial<PayoutBasics>;
type EditConflict = { current: PayoutDetailRecord; patch: EditPatch };

const fieldLabels = {
  name: "Payout 名称",
  unitPrice: "每张售价",
  remark: "备注",
} as const;
const fields = Object.keys(fieldLabels) as (keyof PayoutBasics)[];

function sameValue(
  field: keyof PayoutBasics,
  current: string,
  proposed: string
) {
  return field === "unitPrice"
    ? Number(current) === Number(proposed)
    : current === proposed;
}

function editDifferences(current: PayoutDetailRecord, patch: EditPatch) {
  return fields.flatMap((field) => {
    const proposed = patch[field];
    return proposed !== undefined && !sameValue(field, current[field], proposed)
      ? [{ label: fieldLabels[field], current: current[field], proposed }]
      : [];
  });
}

export function EditPayoutForm({
  payout,
  onReturn,
  onUnavailable,
}: {
  payout: PayoutDetailRecord;
  onReturn: () => void;
  onUnavailable: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [base] = useState(payout);
  const [draft, setDraft] = useState<PayoutBasics>(() => ({
    name: payout.name,
    unitPrice: payout.unitPrice,
    remark: payout.remark,
  }));
  const [issue, setIssue] = useState("");
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<EditConflict>();
  const submitting = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const disabled = pending || Boolean(conflict);

  function change(field: keyof PayoutBasics, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setIssue("");
  }

  async function save(patch: EditPatch, version: number) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setIssue("");
    const start = router.state.location;
    const isCurrentEntry = () =>
      router.state.location.state.__TSR_key === start.state.__TSR_key &&
      router.state.location.href === start.href;

    function finish() {
      toastManager.add({ title: "Payout 已保存" });
      onReturn();
    }

    try {
      await updatePayout(base.id, version, patch);
      if (isCurrentEntry()) finish();
    } catch (error) {
      if (!isCurrentEntry()) return;
      if (
        error instanceof PayoutApiError &&
        error.code === "version_conflict" &&
        isPayoutSnapshot(error.current, base.id)
      ) {
        if (!editDifferences(error.current, patch).length) {
          // 重试时，最新快照可以确认上一次已提交的字段。
          finish();
        } else {
          setConflict({ current: error.current, patch });
        }
        return;
      }
      setConflict(undefined);
      if (isConfirmedPayoutError(error)) {
        if (error.status === 403 || error.status === 404) {
          toastManager.add({ title: "该 Payout 已不可查看", type: "error" });
          onUnavailable();
        } else {
          setIssue(error.message);
        }
      } else {
        setIssue("暂时无法确认保存结果，请重试。");
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    const name = draft.name.trim();
    const unitPrice = draft.unitPrice.trim();
    const remark = draft.remark.trim();
    if (!name) {
      setIssue("请输入 Payout 名称。");
      return;
    }
    if (
      !/^\d+(?:\.\d{1,4})?$/u.test(unitPrice) ||
      Number(unitPrice) <= 0 ||
      Number(unitPrice) > 100000
    ) {
      setIssue("每张售价须大于 0 且不超过 100000，最多四位小数。");
      return;
    }
    const proposed = { name, unitPrice, remark };
    const patch: EditPatch = {};
    for (const field of fields) {
      const value = proposed[field];
      if (!sameValue(field, base[field], value)) patch[field] = value;
    }
    if (!Object.keys(patch).length) {
      onReturn();
      return;
    }
    void save(patch, base.version);
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form className="space-y-5" onSubmit={submit}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">编辑 Payout</h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              disabled={disabled}
              onClick={onReturn}
            >
              取消
            </Button>
            <Button
              ref={saveButton}
              type="submit"
              className="h-10 px-4"
              disabled={disabled}
              aria-busy={pending}
            >
              <Save aria-hidden="true" />
              {pending ? "正在保存…" : "保存"}
            </Button>
          </div>
        </header>
        <FieldError>{issue}</FieldError>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-product`}>产品</FieldLabel>
            <Input
              id={`${id}-product`}
              className="bg-muted/25 text-muted-foreground"
              value={base.product.name}
              readOnly
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{fieldLabels.name}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={draft.name}
              required
              maxLength={128}
              disabled={disabled}
              onChange={(event) => change("name", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-count`}>总张数</FieldLabel>
            <Input
              id={`${id}-count`}
              className="bg-muted/25 text-muted-foreground"
              value={formatPayoutQuantity(base.ticketCount)}
              readOnly
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-price`}>
              {fieldLabels.unitPrice}（{base.currencyCode}）
            </FieldLabel>
            <Input
              id={`${id}-price`}
              value={draft.unitPrice}
              inputMode="decimal"
              required
              disabled={disabled}
              onChange={(event) => change("unitPrice", event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${id}-remark`}>
              {fieldLabels.remark}
            </FieldLabel>
            <Textarea
              id={`${id}-remark`}
              value={draft.remark}
              maxLength={2000}
              disabled={disabled}
              onChange={(event) => change("remark", event.target.value)}
            />
          </Field>
        </div>
      </form>
      <VersionConflictDialog
        differences={
          conflict ? editDifferences(conflict.current, conflict.patch) : null
        }
        description="取消会保留你的修改。覆盖保存会提交下方列出的字段。"
        pending={pending}
        onCancel={() => setConflict(undefined)}
        onOverwrite={() => {
          if (conflict) void save(conflict.patch, conflict.current.version);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          saveButton.current?.focus();
        }}
      />
    </main>
  );
}
