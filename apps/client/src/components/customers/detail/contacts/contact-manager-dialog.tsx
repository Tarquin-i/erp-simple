import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type Ref, type RefObject, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { keepDialogOpenOnComboboxEscape } from "@/components/ui/searchable-select";
import type {
  CustomerContact,
  CustomerContactMethod,
} from "@/request/customers";

import { contactMethodLabels } from "./method-labels";

type MethodAction = (
  method: CustomerContactMethod,
  trigger: HTMLButtonElement
) => void;

function MethodMenu({
  method,
  onEdit,
  onDelete,
}: {
  method: CustomerContactMethod;
  onEdit: MethodAction;
  onDelete: MethodAction;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingAction = useRef(false);

  function selectAction(action: MethodAction) {
    if (!triggerRef.current) return;
    openingAction.current = true;
    action(method, triggerRef.current);
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${contactMethodLabels[method.type]}操作`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!openingAction.current) return;
          // 编辑表单或删除弹窗接管焦点，菜单关闭时不抢回焦点。
          openingAction.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={() => selectAction(onEdit)}>
          <Pencil aria-hidden="true" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => selectAction(onDelete)}
        >
          <Trash2 aria-hidden="true" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 在居中弹窗管理单个联系人的姓名和联系方式，并在同一弹窗中切换到编辑表单。
 * @param props 最新的联系人资料、可选编辑表单、操作回调和焦点回退位置。
 * @returns 联系人管理弹窗。
 */
export function ContactManagerDialog({
  contact,
  title,
  form,
  locked,
  error,
  contentRef,
  addButtonRef,
  onClose,
  onRename,
  onAdd,
  onEdit,
  onDelete,
}: {
  contact: CustomerContact;
  title: string;
  form: ReactNode;
  locked: boolean;
  error: string;
  contentRef: RefObject<HTMLDivElement | null>;
  addButtonRef: Ref<HTMLButtonElement>;
  onClose: () => void;
  onRename: (trigger: HTMLButtonElement) => void;
  onAdd: (trigger: HTMLButtonElement) => void;
  onEdit: MethodAction;
  onDelete: MethodAction;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        className="flex max-h-[85dvh] min-h-0 flex-col gap-4 sm:max-w-xl sm:p-6"
        showCloseButton={!locked}
        onEscapeKeyDown={(event) =>
          keepDialogOpenOnComboboxEscape(event, contentRef.current)
        }
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            管理{contact.name}的姓名和联系方式。
          </DialogDescription>
        </DialogHeader>
        <div className={form ? "hidden" : "min-h-0 space-y-4 overflow-y-auto"}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">联系人姓名</p>
              <p className="mt-0.5 wrap-anywhere font-medium">{contact.name}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(event) => onRename(event.currentTarget)}
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
              编辑姓名
            </Button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-sm">联系方式</p>
              <Button
                ref={addButtonRef}
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="添加联系方式"
                onClick={(event) => onAdd(event.currentTarget)}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            {contact.methods.length === 0 ? (
              <p className="py-2 text-muted-foreground">暂无联系方式</p>
            ) : (
              <ul aria-label="联系方式" className="divide-y divide-border">
                {contact.methods.map((method) => (
                  <li key={method.id} className="flex items-center gap-2 py-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="outline">
                        {contactMethodLabels[method.type]}
                      </Badge>
                      <span className="min-w-0 wrap-anywhere">
                        {method.value}
                      </span>
                      {method.isPrimary && (
                        <Badge variant="secondary">主要</Badge>
                      )}
                    </div>
                    <MethodMenu
                      method={method}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <FieldError>{error}</FieldError>
        </div>
        {form}
      </DialogContent>
    </Dialog>
  );
}
