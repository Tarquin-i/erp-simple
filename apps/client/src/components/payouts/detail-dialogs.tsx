import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPayoutQuantity } from "@/lib/payouts";
import type { PayoutCopyInput, PayoutDetailRecord } from "@/request/payouts";

export type PayoutBasics = Pick<
  PayoutDetailRecord,
  "name" | "unitPrice" | "remark"
>;

export function PayoutBasicsDialog({
  open,
  draft,
  currencyCode,
  pending,
  issue,
  onChange,
  onClose,
  onSubmit,
  onCloseAutoFocus,
}: {
  open: boolean;
  draft: PayoutBasics;
  currencyCode: string;
  pending: boolean;
  issue?: string;
  onChange: (draft: PayoutBasics) => void;
  onClose: () => void;
  onSubmit: (draft: PayoutBasics) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const nameId = useId();
  const priceId = useId();
  const remarkId = useId();
  const [validation, setValidation] = useState("");

  function change(values: Partial<PayoutBasics>) {
    setValidation("");
    onChange({ ...draft, ...values });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        aria-describedby={undefined}
        showCloseButton={!pending}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const name = draft.name.trim();
            const unitPrice = draft.unitPrice.trim();
            if (!name) {
              setValidation("请输入 Payout 名称。");
              return;
            }
            if (
              !/^\d+(?:\.\d{1,4})?$/u.test(unitPrice) ||
              Number(unitPrice) <= 0 ||
              Number(unitPrice) > 100000
            ) {
              setValidation("每张售价须大于 0 且不超过 100000，最多四位小数。");
              return;
            }
            onSubmit({ name, unitPrice, remark: draft.remark.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>编辑基础信息</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={nameId}>Payout 名称</FieldLabel>
              <Input
                id={nameId}
                value={draft.name}
                required
                maxLength={128}
                disabled={pending}
                onChange={(event) => change({ name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={priceId}>
                每张售价（{currencyCode}）
              </FieldLabel>
              <Input
                id={priceId}
                value={draft.unitPrice}
                inputMode="decimal"
                required
                disabled={pending}
                onChange={(event) => change({ unitPrice: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={remarkId}>备注</FieldLabel>
              <Textarea
                id={remarkId}
                value={draft.remark}
                maxLength={2000}
                disabled={pending}
                onChange={(event) => change({ remark: event.target.value })}
              />
            </Field>
          </FieldGroup>
          <FieldError>{validation || issue}</FieldError>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "正在保存…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutCopyDialog({
  payout,
  hasDraft,
  pending,
  issue,
  onChange,
  onClose,
  onSubmit,
  onCloseAutoFocus,
}: {
  payout: PayoutDetailRecord;
  hasDraft: boolean;
  pending: boolean;
  issue?: string;
  onChange: () => void;
  onClose: () => void;
  onSubmit: (input: PayoutCopyInput) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const nameId = useId();
  const countId = useId();
  const [name, setName] = useState("");
  const [count, setCount] = useState(String(payout.ticketCount));
  const [validation, setValidation] = useState("");

  function clearErrors() {
    setValidation("");
    onChange();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        showCloseButton={!pending}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const ticketCount = Number(count.trim());
            if (
              !/^\d+$/u.test(count.trim()) ||
              ticketCount < 1 ||
              ticketCount > 1000000
            ) {
              setValidation("总张数须为 1 至 1000000 的整数。");
              return;
            }
            if (ticketCount < payout.metrics.winningTicketCount) {
              setValidation(
                `总张数至少为 ${formatPayoutQuantity(payout.metrics.winningTicketCount)}，才能容纳已保存的中奖张数。`
              );
              return;
            }
            onSubmit({ name: name.trim() || undefined, ticketCount });
          }}
        >
          <DialogHeader>
            <DialogTitle>复制 Payout</DialogTitle>
            <DialogDescription>
              在同一产品下新建一份 Payout，并带入已保存的奖项。
              {hasDraft && " 继续复制会打开副本，当前奖项草稿将丢失。"}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={nameId}>副本名称</FieldLabel>
              <Input
                id={nameId}
                value={name}
                maxLength={128}
                placeholder="选填，留空自动生成"
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value);
                  clearErrors();
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={countId}>总张数</FieldLabel>
              <Input
                id={countId}
                value={count}
                inputMode="numeric"
                required
                disabled={pending}
                onChange={(event) => {
                  setCount(event.target.value);
                  clearErrors();
                }}
              />
            </Field>
          </FieldGroup>
          <FieldError>{validation || issue}</FieldError>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "正在复制…" : "复制"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutArchiveDialog({
  open,
  name,
  hasDraft,
  pending,
  issue,
  retry,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  name: string;
  hasDraft: boolean;
  pending: boolean;
  issue?: string;
  retry: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && !pending && onClose()}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)] grid-cols-1"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>归档 Payout</AlertDialogTitle>
          <AlertDialogDescription className="min-w-0 wrap-anywhere">
            「{name}」归档后将从列表移除，已保存的资料会保留。
            {hasDraft && " 当前奖项草稿会丢失。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldError>{issue}</FieldError>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "正在归档…" : retry ? "重试归档" : "确认归档"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
