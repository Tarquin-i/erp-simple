import { ChevronRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { AnimatedCollapsibleContent } from "@/components/shared/animated-collapsible-content";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatPayoutMoney, formatPayoutQuantity } from "@/lib/payouts";
import { createUuid } from "@/lib/uuid";
import type { PayoutDefinition, PayoutPrizeGroup } from "@/request/payouts";

import { AwardDialog } from "./award-dialog";
import type { AwardEdit } from "./award-dialog";

type Removal = { groupId: string; prizeId?: string };

type PayoutAwardsProps = {
  definition: PayoutDefinition;
  onChange: (definition: PayoutDefinition) => void;
  ticketCount: number;
  currencyCode: string;
  unitPrice: string;
  disabled?: boolean;
  headerActions?: ReactNode;
};

export function PayoutAwards({
  definition,
  onChange,
  ticketCount,
  currencyCode,
  unitPrice,
  disabled = false,
  headerActions,
}: PayoutAwardsProps) {
  const [editor, setEditor] = useState<AwardEdit | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const addGroupButton = useRef<HTMLButtonElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);

  const groupToRemove = definition.groups.find(
    (group) => group.id === removal?.groupId
  );
  const prizeToRemove = groupToRemove?.prizes.find(
    (prize) => prize.id === removal?.prizeId
  );
  const removesGroup = !removal?.prizeId || groupToRemove?.prizes.length === 1;

  function editFrom(button: HTMLButtonElement, edit: AwardEdit) {
    dialogTrigger.current = button;
    setEditor(edit);
  }

  function removeFrom(button: HTMLButtonElement, target: Removal) {
    dialogTrigger.current = button;
    setRemoval(target);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    const trigger = dialogTrigger.current;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else addGroupButton.current?.focus();
  }

  function removeAward() {
    if (disabled || !groupToRemove || (removal?.prizeId && !prizeToRemove))
      return;

    const groups = removesGroup
      ? definition.groups.filter((group) => group.id !== groupToRemove.id)
      : definition.groups.map((group) =>
          group.id === groupToRemove.id
            ? {
                ...group,
                prizes: group.prizes.filter(
                  (prize) => prize.id !== prizeToRemove?.id
                ),
              }
            : group
        );
    onChange({ groups });
    setRemoval(null);
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="奖项">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">奖项</h2>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            ref={addGroupButton}
            type="button"
            variant="outline"
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={(event) =>
              editFrom(event.currentTarget, {
                kind: "new-group",
                groupId: createUuid(),
                prizeId: createUuid(),
              })
            }
          >
            <Plus data-icon="inline-start" />
            新增奖项组
          </Button>
          {headerActions}
        </div>
      </div>

      {definition.groups.length === 0 ? (
        <Empty className="min-h-28 border py-8">
          <EmptyHeader>
            <EmptyTitle>暂无奖项</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-1">
          {definition.groups.map((group) => (
            <PayoutAwardGroup
              key={group.id}
              group={group}
              currencyCode={currencyCode}
              disabled={disabled}
              onEdit={editFrom}
              onRemove={removeFrom}
            />
          ))}
        </div>
      )}

      {editor ? (
        <AwardDialog
          edit={editor}
          definition={definition}
          ticketCount={ticketCount}
          currencyCode={currencyCode}
          unitPrice={unitPrice}
          disabled={disabled}
          onAccept={(draft) => {
            onChange(draft);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}

      {groupToRemove && (!removal?.prizeId || prizeToRemove) && (
        <AlertDialog open onOpenChange={(open) => !open && setRemoval(null)}>
          <AlertDialogContent
            className="w-[calc(100%-2rem)] min-w-0"
            onCloseAutoFocus={restoreFocus}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removesGroup ? "删除奖项组" : "删除奖项"}
              </AlertDialogTitle>
              <AlertDialogDescription className="min-w-0 wrap-anywhere">
                {prizeToRemove && removesGroup
                  ? `「${prizeToRemove.name}」是「${groupToRemove.name}」的最后一个奖项。删除后会一并移除该组。`
                  : `确定删除「${prizeToRemove?.name ?? groupToRemove.name}」？`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={disabled}
                variant="destructive"
                onClick={removeAward}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}

const branchClass =
  "relative flex min-h-10 items-center gap-2 pl-1 before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:border-l before:border-border last:before:bottom-1/2 after:pointer-events-none after:absolute after:top-1/2 after:-left-4 after:w-3 after:border-b after:border-border";

function PayoutAwardGroup({
  group,
  currencyCode,
  disabled,
  onEdit,
  onRemove,
}: {
  group: PayoutPrizeGroup;
  currencyCode: string;
  disabled: boolean;
  onEdit: (trigger: HTMLButtonElement, edit: AwardEdit) => void;
  onRemove: (trigger: HTMLButtonElement, target: Removal) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      role="group"
      aria-label={group.name}
    >
      <div className="flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/70">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group/award h-9 min-w-0 flex-1 justify-start gap-2 px-2.5 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
          >
            <Layers aria-hidden="true" className="text-muted-foreground" />
            <span className="truncate" title={group.name}>
              {group.name}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none group-data-[state=open]/award:rotate-90"
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatPayoutQuantity(group.prizes.length)} 项
            </span>
          </Button>
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-haspopup="dialog"
          aria-label={`重命名奖项组 ${group.name}`}
          title="重命名奖项组"
          disabled={disabled}
          onClick={(event) =>
            onEdit(event.currentTarget, { kind: "rename-group", group })
          }
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-haspopup="dialog"
          aria-label={`给 ${group.name} 新增奖项`}
          title="新增奖项"
          disabled={disabled}
          onClick={(event) =>
            onEdit(event.currentTarget, {
              kind: "new-prize",
              group,
              prizeId: createUuid(),
            })
          }
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-haspopup="dialog"
          aria-label={`删除奖项组 ${group.name}`}
          title="删除奖项组"
          disabled={disabled}
          onClick={(event) =>
            onRemove(event.currentTarget, { groupId: group.id })
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <AnimatedCollapsibleContent open={expanded}>
        <ul className="ml-4 pl-4" aria-hidden={!expanded}>
          {group.prizes.map((prize) => (
            <li key={prize.id} className={branchClass}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <Badge
                  variant="outline"
                  className="h-auto min-h-5 max-w-full shrink py-0.5 whitespace-normal wrap-anywhere"
                >
                  {prize.name}
                </Badge>
                <span className="min-w-0 wrap-anywhere tabular-nums">
                  {formatPayoutMoney(String(prize.amount), currencyCode)}
                  <span className="ml-1 text-muted-foreground">/ 张</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  中奖 {formatPayoutQuantity(prize.quantity)} 张
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1 pr-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-haspopup="dialog"
                  aria-label={`编辑奖项 ${prize.name}`}
                  title="编辑奖项"
                  disabled={disabled}
                  onClick={(event) =>
                    onEdit(event.currentTarget, {
                      kind: "edit-prize",
                      group,
                      prize,
                    })
                  }
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-haspopup="dialog"
                  aria-label={`删除奖项 ${prize.name}`}
                  title="删除奖项"
                  disabled={disabled}
                  onClick={(event) =>
                    onRemove(event.currentTarget, {
                      groupId: group.id,
                      prizeId: prize.id,
                    })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AnimatedCollapsibleContent>
    </Collapsible>
  );
}
