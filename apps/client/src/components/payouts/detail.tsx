import { Link, useRouter } from "@tanstack/react-router";
import { Archive, Copy, Pencil, Save } from "lucide-react";
import { useRef, useState } from "react";

import { DetailField } from "@/components/shared/detail-field";
import { toastManager } from "@/components/shared/toast";
import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  calculatePayoutMetrics,
  formatPayoutMoney,
  formatPayoutPercent,
  formatPayoutQuantity,
} from "@/lib/payouts";
import { createUuid } from "@/lib/uuid";
import {
  archivePayout,
  copyPayout,
  isPayoutSnapshot,
  PayoutApiError,
  updatePayout,
} from "@/request/payouts";
import type {
  PayoutCopyInput,
  PayoutDefinition,
  PayoutDetailRecord,
  PayoutPatch,
} from "@/request/payouts";

import { PayoutAwards } from "./awards";
import {
  PayoutArchiveDialog,
  PayoutBasicsDialog,
  PayoutCopyDialog,
} from "./detail-dialogs";
import type { PayoutBasics } from "./detail-dialogs";

type SaveKind = "basics" | "awards";
type WriteKind = SaveKind | "copy" | "archive";
type SaveConflict = {
  kind: SaveKind;
  current: PayoutDetailRecord;
  patch: PayoutPatch;
};

const uncertainArchive = "暂时无法确认归档结果，请重试。";
const basicLabels = {
  name: "Payout 名称",
  unitPrice: "每张售价",
  remark: "备注",
} as const;
const basicFields = Object.keys(basicLabels) as (keyof PayoutBasics)[];

function uncertainFailure(error: unknown) {
  return (
    !(error instanceof PayoutApiError) ||
    error.status >= 500 ||
    [408, 429].includes(error.status)
  );
}

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

function equalBasic(field: keyof PayoutBasics, left: string, right: string) {
  return field === "unitPrice"
    ? Number(left) === Number(right)
    : left === right;
}

function matchesPatch(payout: PayoutDetailRecord, patch: PayoutPatch) {
  return (
    basicFields.every(
      (field) =>
        patch[field] === undefined ||
        equalBasic(field, payout[field], patch[field])
    ) &&
    (patch.definition === undefined ||
      matchesDefinition(payout.definition, patch.definition))
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

function conflictDifferences({ current, patch }: SaveConflict) {
  const rows = basicFields.flatMap((field) => {
    const proposed = patch[field];
    return proposed !== undefined &&
      !equalBasic(field, current[field], proposed)
      ? [{ label: basicLabels[field], current: current[field], proposed }]
      : [];
  });
  return patch.definition
    ? [
        ...rows,
        {
          label: "奖项",
          current: describeDefinition(current.definition, current.currencyCode),
          proposed: describeDefinition(patch.definition, current.currencyCode),
        },
      ]
    : rows;
}

export function PayoutDetail({
  payout,
  onReturn,
  onCopy,
}: {
  payout: PayoutDetailRecord;
  onReturn: (discard: boolean) => void;
  onCopy: (payoutId: string) => void;
}) {
  const router = useRouter();
  const [latest, setLatest] = useState<PayoutDetailRecord>();
  const [awardDraft, setAwardDraft] = useState<{
    definition: PayoutDefinition;
    baseDefinition: PayoutDefinition;
    version: number;
  }>();
  const [basicEdit, setBasicEdit] = useState<{
    draft: PayoutBasics;
    base: PayoutDetailRecord;
  }>();
  const [copyOpen, setCopyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveRetryVersion, setArchiveRetryVersion] = useState<number>();
  const [conflict, setConflict] = useState<SaveConflict>();
  const [issues, setIssues] = useState<Partial<Record<WriteKind, string>>>({});
  const [pending, setPending] = useState<WriteKind>();
  const inFlight = useRef(false);
  const copySubmissions = useRef(new Map<string, string>());
  const editButton = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const saveAwardsButton = useRef<HTMLButtonElement>(null);
  const conflictKind = useRef<SaveKind>(undefined);

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

  function confirmSaved(
    kind: SaveKind,
    record: PayoutDetailRecord,
    version: number
  ) {
    setLatest(record);
    setConflict(undefined);
    if (kind === "awards") {
      setAwardDraft(undefined);
    } else {
      setBasicEdit(undefined);
      // 本次只保存基础信息，保留同一版本上已有的奖项草稿。
      setAwardDraft((draft) =>
        draft?.version === version &&
        matchesDefinition(draft.baseDefinition, record.definition)
          ? { ...draft, version: record.version }
          : draft
      );
    }
    toastManager.add({
      title: kind === "awards" ? "奖项已保存" : "Payout 已保存",
    });
  }

  function save(kind: SaveKind, patch: PayoutPatch, version: number) {
    void runWrite(
      kind,
      () => updatePayout(current.id, version, patch),
      (record) => confirmSaved(kind, record, version),
      (error) => {
        if (
          error instanceof PayoutApiError &&
          error.code === "version_conflict" &&
          isPayoutSnapshot(error.current, current.id)
        ) {
          const saved = error.current;
          if (matchesPatch(saved, patch)) {
            // 保存已提交但响应丢失时，重试会返回包含已保存内容的版本冲突。
            confirmSaved(kind, saved, version);
            return;
          }
          setLatest(saved);
          conflictKind.current = kind;
          setConflict({ kind, current: saved, patch });
          return;
        }
        setConflict(undefined);
        showIssue(
          kind,
          uncertainFailure(error)
            ? "暂时无法确认保存结果，请重试。"
            : (error as PayoutApiError).message
        );
      }
    );
  }

  function saveBasics(values: PayoutBasics) {
    if (!basicEdit) return;
    const changes = basicFields.filter(
      (field) => !equalBasic(field, basicEdit.base[field], values[field])
    );
    if (!changes.length) {
      setBasicEdit(undefined);
      return;
    }
    const patch: PayoutPatch = {};
    for (const field of changes) patch[field] = values[field];
    save("basics", patch, basicEdit.base.version);
  }

  function submitCopy(input: PayoutCopyInput) {
    const payload = JSON.stringify(input);
    const submissions = copySubmissions.current;
    const submissionId = submissions.get(payload) ?? createUuid();
    submissions.set(payload, submissionId);

    void runWrite(
      "copy",
      () => copyPayout(current.id, input, submissionId),
      (created) => {
        setCopyOpen(false);
        toastManager.add({ title: "Payout 已复制" });
        onCopy(created.id);
      },
      (error) => {
        if (uncertainFailure(error)) {
          showIssue("copy", "暂时无法确认复制结果，请使用原资料重试。");
          return;
        }
        submissions.delete(payload);
        showIssue("copy", (error as PayoutApiError).message);
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
      (error) => {
        if (uncertainFailure(error)) {
          setArchiveRetryVersion(version);
          showIssue("archive", uncertainArchive);
          return;
        }
        setArchiveRetryVersion(undefined);
        const failure = error as PayoutApiError;
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
            ref={editButton}
            disabled={Boolean(pending)}
            onClick={() => {
              showIssue("basics");
              const { name, unitPrice, remark } = current;
              setBasicEdit({
                draft: { name, unitPrice, remark },
                base: current,
              });
            }}
          >
            <Pencil data-icon="inline-start" />
            编辑
          </Button>
          <Button
            type="button"
            variant="outline"
            ref={copyButton}
            disabled={Boolean(pending)}
            onClick={() => {
              showIssue("copy");
              setCopyOpen(true);
            }}
          >
            <Copy data-icon="inline-start" />
            复制
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
                  baseDefinition:
                    awardDraft?.baseDefinition ?? current.definition,
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
                size="sm"
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
                size="sm"
                ref={saveAwardsButton}
                disabled={Boolean(pending)}
                onClick={() =>
                  save(
                    "awards",
                    { definition: awardDraft.definition },
                    awardDraft.version
                  )
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

      {basicEdit && (
        <PayoutBasicsDialog
          open={conflict?.kind !== "basics"}
          draft={basicEdit.draft}
          currencyCode={current.currencyCode}
          pending={pending === "basics"}
          issue={issues.basics}
          onChange={(draft) => {
            showIssue("basics");
            setBasicEdit({ ...basicEdit, draft });
          }}
          onClose={() => setBasicEdit(undefined)}
          onSubmit={saveBasics}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!conflict) editButton.current?.focus();
          }}
        />
      )}
      {copyOpen && (
        <PayoutCopyDialog
          payout={current}
          hasDraft={Boolean(awardDraft)}
          pending={pending === "copy"}
          issue={issues.copy}
          onChange={() => showIssue("copy")}
          onClose={() => setCopyOpen(false)}
          onSubmit={submitCopy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            copyButton.current?.focus();
          }}
        />
      )}
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
        differences={conflict ? conflictDifferences(conflict) : null}
        description={
          conflict?.kind === "awards"
            ? "取消会保留奖项草稿。覆盖保存会使用你的完整奖项列表。"
            : "取消会保留你的修改。覆盖保存会提交下方列出的字段。"
        }
        pending={Boolean(pending)}
        onCancel={() => setConflict(undefined)}
        onOverwrite={() => {
          if (conflict)
            save(conflict.kind, conflict.patch, conflict.current.version);
        }}
        onCloseAutoFocus={(event) => {
          if (conflictKind.current === "awards" && saveAwardsButton.current) {
            event.preventDefault();
            saveAwardsButton.current.focus();
          }
        }}
      />
    </main>
  );
}
