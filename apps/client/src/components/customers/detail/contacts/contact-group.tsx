import { ChevronRight, Pencil, Plus, UserRound } from "lucide-react";

import { AnimatedCollapsibleContent } from "@/components/shared/animated-collapsible-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CustomerContact } from "@/request/customers";

import { contactMethodLabels } from "./method-labels";

const branchClass =
  "relative flex min-h-10 items-center gap-2 pl-1 before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:border-l before:border-border last:before:bottom-1/2 after:pointer-events-none after:absolute after:top-1/2 after:-left-4 after:w-3 after:border-b after:border-border";

/**
 * 展示单个可展开的联系人分组及其联系方式。
 * @param props 联系人资料、当前展开状态及状态变更和管理操作的回调。
 * @returns 可独立展开或收起的联系人内容。
 */
export function ContactGroup({
  contact,
  expanded,
  onExpandedChange,
  onManage,
  onAdd,
}: {
  contact: CustomerContact;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onManage: (trigger: HTMLButtonElement) => void;
  onAdd: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <div className="flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/70">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group/contact h-9 min-w-0 flex-1 justify-start gap-2 px-2.5 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
          >
            <UserRound aria-hidden="true" className="text-muted-foreground" />
            <span className="truncate">{contact.name}</span>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none group-data-[state=open]/contact:rotate-90"
            />
            <span className="shrink-0 text-muted-foreground text-xs">
              {contact.methods.length} 项
            </span>
          </Button>
        </CollapsibleTrigger>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`编辑联系人 ${contact.name}`}
          title="编辑联系人"
          onClick={(event) => onManage(event.currentTarget)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`给 ${contact.name} 添加联系方式`}
          title="添加联系方式"
          onClick={(event) => onAdd(event.currentTarget)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <AnimatedCollapsibleContent open={expanded}>
        <ul className="ml-4 pl-4">
          {contact.methods.length === 0 && (
            <li className={`${branchClass} text-muted-foreground`}>
              暂无联系方式
            </li>
          )}
          {contact.methods.map((method) => (
            <li key={method.id} className={branchClass}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <Badge variant="outline">
                  {contactMethodLabels[method.type]}
                </Badge>
                <span className="min-w-0 wrap-anywhere">{method.value}</span>
                {method.isPrimary && <Badge variant="secondary">主要</Badge>}
              </div>
            </li>
          ))}
        </ul>
      </AnimatedCollapsibleContent>
    </Collapsible>
  );
}
