import { Link, useBlocker, useRouter } from "@tanstack/react-router";
import { Archive, Pencil, Save } from "lucide-react";
import { useRef, useState } from "react";

import { DetailField } from "@/components/shared/detail-field";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  calculatePayoutMetrics,
  formatPayoutMoney,
  formatPayoutPercent,
  formatPayoutQuantity,
} from "@/lib/payouts";
import {
  archivePayout,
  isConfirmedPayoutError,
  isPayoutSnapshot,
  PayoutApiError,
  updatePayout,
} from "@/request/payouts";
import type { PayoutDefinition, PayoutDetailRecord } from "@/request/payouts";

import { PayoutArchiveDialog } from "./archive-dialog";
import { PayoutAwards } from "./awards";

type WriteKind = "awards" | "archive";
type AwardConflict = {
  current: PayoutDetailRecord;
  proposed: PayoutDefinition;
};

const uncertainArchive = "暂时无法确认归档结果，请重试。";

function matchesDefinition(left: PayoutDefinition, right: PayoutDefinition) {
  return (
    left.groups.length === right.groups.length &&
    left.groups.every((group, index) => {
      const other = right.groups[index];
      return (
        group.id === other.id &&
        group.name === other.name &&
        group.prizes.length === other.prizes.length &&
        group.prizes.every((prize, position) => {
          const matching = other.prizes[position];
          return (
            prize.id === matching.id &&
            prize.name === matching.name &&
            prize.amount === matching.amount &&
            prize.quantity === matching.quantity
          );
        })
      );
    })
  );
}

function describeDefinition(
  definition: PayoutDefinition,
  currencyCode: string
) {
  return (
    definition.groups
      .map((group) =>
        [
          group.name,
          ...group.prizes.map(
            (prize) =>
              `${prize.name}　${formatPayoutMoney(String(prize.amount), currencyCode)} × ${formatPayoutQuantity(prize.quantity)} 张`
          ),
        ].join("\n")
      )
      .join("\n\n") || "暂无奖项"
  );
}

export function PayoutDetail({
  payout,
  onEdit,
  onReturn,
}: {
  payout: PayoutDetailRecord;
  onEdit: () => void;
  onReturn: (discard: boolean) => void;
}) {
  const router = useRouter();
  const [latest, setLatest] = useState<PayoutDetailRecord>();
  const [awardDraft, setAwardDraft] = useState<{
    definition: PayoutDefinition;
    version: number;
  }>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveRetryVersion, setArchiveRetryVersion] = useState<number>();
  const [conflict, setConflict] = useState<AwardConflict>();
  const [issues, setIssues] = useState<Partial<Record<WriteKind, string>>>({});
  const [pending, setPending] = useState<WriteKind>();
  const inFlight = useRef(false);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const saveAwardsButton = useRef<HTMLButtonElement>(null);
  const leaveWithDraft = useBlocker({
    disabled: !awardDraft,
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      next.routeId !== "/_auth/login/" &&
      next.routeId !== "/department-access/",
    withResolver: true,
  });

  const current = latest && latest.version >= payout.version ? latest : payout;
  const definition = awardDraft?.definition ?? current.definition;
  const metrics = awardDraft
    ? calculatePayoutMetrics(definition, current.ticketCount, current.unitPrice)
    : current.metrics;

  function showIssue(kind: WriteKind, message?: string) {
    setIssues((previous) => ({ ...previous, [kind]: message }));
  }

  async function runWrite(
    kind: WriteKind,
    execute: () => Promise<{ payout: PayoutDetailRecord }>,
    onDone: (saved: PayoutDetailRecord) => void,
    onError: (error: unknown) => void
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    showIssue(kind);
    const start = router.state.location;
    const isCurrentLocation = () => {
      const location = router.state.location;
      return (
        location.href === start.href &&
        location.state.__TSR_key === start.state.__TSR_key
      );
    };
    try {
      const result = await execute();
      if (isCurrentLocation()) onDone(result.payout);
    } catch (error) {
      if (!isCurrentLocation()) return;
      if (
        error instanceof PayoutApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        toastManager.add({ title: "该 Payout 已不可查看", type: "error" });
        onReturn(true);
      } else {
        onError(error);
      }
    } finally {
      inFlight.current = false;
      setPending(undefined);
    }
  }

  function confirmAwardsSaved(record: PayoutDetailRecord) {
    setLatest(record);
    setConflict(undefined);
    setAwardDraft(undefined);
    toastManager.add({ title: "奖项已保存" });
  }

  function saveAwards(proposed: PayoutDefinition, version: number) {
    void runWrite(
      "awards",
      () => updatePayout(current.id, version, { definition: proposed }),
      confirmAwardsSaved,
      (error) => {
        if (
          error instanceof PayoutApiError &&
          error.code === "version_conflict" &&
          isPayoutSnapshot(error.current, current.id)
        ) {
          const saved = error.current;
          if (matchesDefinition(saved.definition, proposed)) {
            // 保存已提交但响应丢失时，重试会返回包含已保存内容的版本冲突。
            confirmAwardsSaved(saved);
            return;
          }
          setLatest(saved);
          setConflict({ current: saved, proposed });
          return;
        }
        setConflict(undefined);
        showIssue(
          "awards",
          isConfirmedPayoutError(error)
            ? error.message
            : "暂时无法确认保存结果，请重试。"
        );
      }
    );
  }

  function submitArchive() {
    const version = archiveRetryVersion ?? current.version;
    void runWrite(
      "archive",
      () => archivePayout(current.id, version),
      () => {
        setArchiveOpen(false);
        toastManager.add({ title: "Payout 已归档" });
        onReturn(true);
      },
      (failure) => {
        if (!isConfirmedPayoutError(failure)) {
          setArchiveRetryVersion(version);
          showIssue("archive", uncertainArchive);
          return;
        }
        setArchiveRetryVersion(undefined);
        if (
          failure.code === "version_conflict" &&
          isPayoutSnapshot(failure.current, current.id)
        ) {
          setLatest(failure.current);
          setArchiveOpen(false);
          toastManager.add({
            title: "Payout 已更新，请核对最新资料后再确认归档。",
            type: "error",
          });
          return;
        }
        showIssue("archive", failure.message);
      }
    );
  }

  return (
    <main className="min-w-0 flex-1 space-y-6 bg-background px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-anywhere">
          {current.name}
        </h1>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(pending)}
            onClick={onEdit}
          >
            <Pencil data-icon="inline-start" />
            编辑
          </Button>
          <Button
            type="button"
            variant="destructive"
            ref={archiveButton}
            disabled={Boolean(pending)}
            onClick={() => {
              showIssue(
                "archive",
                archiveRetryVersion === undefined ? undefined : uncertainArchive
              );
              setArchiveOpen(true);
            }}
          >
            <Archive data-icon="inline-start" />
            归档
          </Button>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">基础信息</h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <DetailField label="产品">
            <Link
              to="/products/$productId"
              params={{ productId: current.product.id }}
              className="underline-offset-4 hover:underline"
            >
              {current.product.name}
              <span className="ml-2 text-muted-foreground">
                {current.product.productNo}
              </span>
            </Link>
          </DetailField>
          <DetailField label="总张数">
            <span className="tabular-nums">
              {formatPayoutQuantity(current.ticketCount)}
            </span>
          </DetailField>
          <DetailField label="每张售价">
            <span className="tabular-nums">
              {current.currencyCode} {current.unitPrice}
            </span>
          </DetailField>
          {current.remark && (
            <DetailField label="备注" className="sm:col-span-3">
              <p className="leading-6 whitespace-pre-wrap">{current.remark}</p>
            </DetailField>
          )}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          {awardDraft ? "赔付试算" : "赔付概览"}
        </h2>
        <dl
          className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-6 tabular-nums"
          aria-live="polite"
        >
          <DetailField label="中奖张数">
            {formatPayoutQuantity(metrics.winningTicketCount)}
          </DetailField>
          <DetailField label="未中奖张数">
            {formatPayoutQuantity(metrics.losingTicketCount)}
          </DetailField>
          <DetailField label="销售总额">
            {formatPayoutMoney(metrics.salesAmount, current.currencyCode)}
          </DetailField>
          <DetailField label="预计赔付">
            {formatPayoutMoney(metrics.payoutAmount, current.currencyCode)}
          </DetailField>
          <DetailField label="赔付率">
            {formatPayoutPercent(metrics.paybackPercent)}
          </DetailField>
          <DetailField label="预计利润">
            {formatPayoutMoney(metrics.profitAmount, current.currencyCode)}
          </DetailField>
        </dl>
      </section>

      <PayoutAwards
        definition={definition}
        ticketCount={current.ticketCount}
        currencyCode={current.currencyCode}
        unitPrice={current.unitPrice}
        disabled={Boolean(pending || conflict)}
        onChange={(next) => {
          setAwardDraft(
            matchesDefinition(next, current.definition)
              ? undefined
              : {
                  definition: next,
                  version: awardDraft?.version ?? current.version,
                }
          );
          showIssue("awards");
        }}
        headerActions={
          awardDraft && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(pending)}
                onClick={() => {
                  setAwardDraft(undefined);
                  showIssue("awards");
                }}
              >
                放弃修改
              </Button>
              <Button
                type="button"
                ref={saveAwardsButton}
                disabled={Boolean(pending)}
                onClick={() =>
                  saveAwards(awardDraft.definition, awardDraft.version)
                }
              >
                <Save data-icon="inline-start" />
                {pending === "awards" ? "正在保存…" : "保存奖项"}
              </Button>
            </>
          )
        }
      />
      <FieldError>{issues.awards}</FieldError>

      <AlertDialog
        open={leaveWithDraft.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) leaveWithDraft.reset?.();
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>离开 Payout 详情？</AlertDialogTitle>
            <AlertDialogDescription>
              离开后，未保存的奖项修改会丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                leaveWithDraft.proceed?.();
              }}
            >
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayoutArchiveDialog
        open={archiveOpen}
        name={current.name}
        hasDraft={Boolean(awardDraft)}
        pending={pending === "archive"}
        issue={issues.archive}
        retry={archiveRetryVersion !== undefined}
        onClose={() => setArchiveOpen(false)}
        onConfirm={submitArchive}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          archiveButton.current?.focus();
        }}
      />
      <VersionConflictDialog
        differences={
          conflict
            ? [
                {
                  label: "奖项",
                  current: describeDefinition(
                    conflict.current.definition,
                    conflict.current.currencyCode
                  ),
                  proposed: describeDefinition(
                    conflict.proposed,
                    conflict.current.currencyCode
                  ),
                },
              ]
            : null
        }
        description="取消会保留奖项草稿。覆盖保存会使用你的完整奖项列表。"
        pending={Boolean(pending)}
        onCancel={() => setConflict(undefined)}
        onOverwrite={() => {
          if (conflict) saveAwards(conflict.proposed, conflict.current.version);
        }}
        onCloseAutoFocus={(event) => {
          if (saveAwardsButton.current) {
            event.preventDefault();
            saveAwardsButton.current.focus();
          }
        }}
      />
    </main>
  );
}
