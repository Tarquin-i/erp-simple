import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  calculatePayoutMetrics,
  formatPayoutMoney,
  formatPayoutPercent,
  formatPayoutQuantity,
} from "@/lib/payouts";
import type {
  PayoutDefinition,
  PayoutPrize,
  PayoutPrizeGroup,
} from "@/request/payouts";

export type AwardEdit =
  | { kind: "new-group"; groupId: string; prizeId: string }
  | { kind: "rename-group"; group: PayoutPrizeGroup }
  | { kind: "new-prize"; group: PayoutPrizeGroup; prizeId: string }
  | { kind: "edit-prize"; group: PayoutPrizeGroup; prize: PayoutPrize };

const editorTitle = {
  "new-group": "新增奖项组",
  "rename-group": "重命名奖项组",
  "new-prize": "新增奖项",
  "edit-prize": "编辑奖项",
};

type AwardFields = {
  groupName: string;
  name: string;
  amount: string;
  quantity: string;
};

type DraftResult =
  | { definition: PayoutDefinition }
  | { field: keyof AwardFields | "form"; message: string };

const maxNameLength = 128;
const maxGroups = 1_000;
const maxPrizes = 10_000;
const maxPrizeCents = BigInt(Number.MAX_SAFE_INTEGER);

function validName(name: string) {
  return (
    name.length > 0 &&
    name.length <= maxNameLength &&
    !name.includes("\0") &&
    !/[\uD800-\uDFFF]/u.test(name)
  );
}

function readPrizeAmount(value: string) {
  const parts = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!parts?.[1]) return undefined;

  const whole = parts[1].replace(/^0+(?=\d)/u, "");
  const fraction = parts[2]?.replace(/0+$/u, "") ?? "";
  const decimal = fraction ? `${whole}.${fraction}` : whole;
  const amount = Number(decimal);
  if (
    amount > 0 &&
    String(amount) === decimal &&
    BigInt(`${whole}${fraction.padEnd(2, "0")}`) <= maxPrizeCents
  ) {
    return amount;
  }
}

function prepareDraft(
  edit: AwardEdit,
  fields: AwardFields,
  definition: PayoutDefinition,
  ticketCount: number
): DraftResult {
  const { groups } = definition;
  const group =
    edit.kind === "new-group"
      ? undefined
      : groups.find((entry) => entry.id === edit.group.id);
  if (edit.kind !== "new-group" && !group) {
    return { field: "form", message: "奖项组已变更，请重新打开。" };
  }

  const groupName = fields.groupName.trim();
  if (edit.kind === "new-group" || edit.kind === "rename-group") {
    if (!validName(groupName)) {
      return { field: "groupName", message: "请填写有效的奖项组名称。" };
    }
    if (
      groups.some(
        (entry) =>
          entry.id !== group?.id &&
          entry.name.trim().toLowerCase() === groupName.toLowerCase()
      )
    ) {
      return { field: "groupName", message: "奖项组名称不能重复。" };
    }
    if (edit.kind === "rename-group") {
      return {
        definition: {
          groups: groups.map((entry) =>
            entry.id === group?.id ? { ...entry, name: groupName } : entry
          ),
        },
      };
    }
    if (groups.length >= maxGroups) {
      return { field: "form", message: `最多可添加 ${maxGroups} 个奖项组。` };
    }
  }

  const name = fields.name.trim();
  if (!validName(name)) {
    return { field: "name", message: "请填写有效的奖项名称。" };
  }
  const prizeId = edit.kind === "edit-prize" ? edit.prize.id : edit.prizeId;
  const prizes = groups.flatMap((entry) => entry.prizes);
  const existingPrizes = prizes.filter((prize) => prize.id !== prizeId);
  if (edit.kind === "edit-prize" && existingPrizes.length === prizes.length) {
    return { field: "form", message: "奖项已变更，请重新打开。" };
  }
  if (existingPrizes.length >= maxPrizes) {
    return { field: "form", message: `最多可添加 ${maxPrizes} 个奖项。` };
  }
  if (
    existingPrizes.some(
      (prize) => prize.name.trim().toLowerCase() === name.toLowerCase()
    )
  ) {
    return { field: "name", message: "奖项名称不能重复。" };
  }

  const amount = readPrizeAmount(fields.amount);
  if (amount === undefined) {
    return { field: "amount", message: "单张奖金须大于 0，最多保留两位小数。" };
  }
  const quantity = Number(fields.quantity);
  if (
    !/^\d+$/u.test(fields.quantity.trim()) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    return { field: "quantity", message: "中奖张数须为正整数。" };
  }
  const winning = existingPrizes.reduce(
    (total, prize) => total + prize.quantity,
    quantity
  );
  if (winning > ticketCount) {
    return {
      field: "quantity",
      message: `中奖张数合计不能超过发行总张数 ${formatPayoutQuantity(ticketCount)}。`,
    };
  }

  const prize = { id: prizeId, name, amount, quantity };
  if (edit.kind === "new-group") {
    return {
      definition: {
        groups: [
          ...groups,
          { id: edit.groupId, name: groupName, prizes: [prize] },
        ],
      },
    };
  }
  return {
    definition: {
      groups: groups.map((entry) =>
        entry.id === group?.id
          ? {
              ...entry,
              prizes:
                edit.kind === "edit-prize"
                  ? entry.prizes.map((item) =>
                      item.id === prize.id ? prize : item
                    )
                  : [...entry.prizes, prize],
            }
          : entry
      ),
    },
  };
}

export function AwardDialog({
  edit,
  definition,
  ticketCount,
  currencyCode,
  unitPrice,
  disabled,
  onAccept,
  onClose,
  onCloseAutoFocus,
}: {
  edit: AwardEdit;
  definition: PayoutDefinition;
  ticketCount: number;
  currencyCode: string;
  unitPrice: string;
  disabled: boolean;
  onAccept: (definition: PayoutDefinition) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const formId = useId();
  const [fields, setFields] = useState<AwardFields>(() => ({
    groupName: edit.kind === "rename-group" ? edit.group.name : "",
    name: edit.kind === "edit-prize" ? edit.prize.name : "",
    amount: edit.kind === "edit-prize" ? String(edit.prize.amount) : "",
    quantity: edit.kind === "edit-prize" ? String(edit.prize.quantity) : "",
  }));
  const [submitted, setSubmitted] = useState(false);
  const draft = prepareDraft(edit, fields, definition, ticketCount);
  const error = submitted && "message" in draft ? draft : undefined;
  const metrics =
    edit.kind !== "rename-group" && "definition" in draft
      ? calculatePayoutMetrics(draft.definition, ticketCount, unitPrice)
      : null;

  function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitted(true);
    if ("definition" in draft) onAccept(draft.definition);
  }

  function renderField(
    field: keyof AwardFields,
    label: string,
    inputMode?: "decimal" | "numeric"
  ) {
    const id = `${formId}-${field}`;
    const message = error?.field === field ? error.message : undefined;
    return (
      <Field data-invalid={Boolean(message)}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          value={fields[field]}
          maxLength={inputMode ? 24 : maxNameLength}
          inputMode={inputMode}
          disabled={disabled}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? `${id}-error` : undefined}
          onChange={(event) => {
            const { value } = event.currentTarget;
            setFields((values) => ({
              ...values,
              [field]: value,
            }));
          }}
        />
        {message ? <FieldError id={`${id}-error`}>{message}</FieldError> : null}
      </Field>
    );
  }

  const adds = edit.kind === "new-group" || edit.kind === "new-prize";
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-semibold">
            {editorTitle[edit.kind]}
          </SheetTitle>
          <SheetDescription
            className={edit.kind === "new-group" ? undefined : "sr-only"}
          >
            {edit.kind === "new-group"
              ? "填写组名称和第一条奖项。"
              : editorTitle[edit.kind]}
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={accept}
          noValidate
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            {(edit.kind === "new-prize" || edit.kind === "edit-prize") && (
              <div className="space-y-1.5 text-sm">
                <p className="text-muted-foreground">奖项组</p>
                <p className="font-medium wrap-anywhere">{edit.group.name}</p>
              </div>
            )}
            <FieldGroup className="gap-4">
              {edit.kind === "new-group" || edit.kind === "rename-group"
                ? renderField("groupName", "奖项组名称")
                : null}
              {edit.kind !== "rename-group" ? (
                <>
                  {renderField("name", "奖项名称")}
                  <div className="grid min-w-0 grid-cols-2 gap-4">
                    {renderField("amount", "单张奖金", "decimal")}
                    {renderField("quantity", "中奖张数", "numeric")}
                  </div>
                </>
              ) : null}
              {error?.field === "form" ? (
                <FieldError>{error.message}</FieldError>
              ) : null}
            </FieldGroup>

            {metrics ? (
              <dl
                aria-label="试算汇总"
                className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3"
              >
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    中奖张数合计
                  </dt>
                  <dd className="mt-1 wrap-anywhere tabular-nums">
                    {formatPayoutQuantity(metrics.winningTicketCount)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">预计赔付</dt>
                  <dd className="mt-1 wrap-anywhere tabular-nums">
                    {formatPayoutMoney(metrics.payoutAmount, currencyCode)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">赔付率</dt>
                  <dd className="mt-1 wrap-anywhere tabular-nums">
                    {formatPayoutPercent(metrics.paybackPercent)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={disabled}>
              {adds ? "添加" : "确认修改"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
