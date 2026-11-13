import { ContactRound, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCustomerContacts } from "@/request/customers";
import type {
  CustomerContact,
  CustomerContactMethod,
} from "@/request/customers";

import { CustomerPagination } from "../../pagination";
import { VersionConflictDialog } from "../../version-conflict-dialog";
import { CustomerContactEditor } from "./contact-editor";
import type { ContactEditorMode } from "./contact-editor";
import { contactMethodLabels } from "./method-labels";
import { contactRequest } from "./mutations";
import type { ContactChange, DeleteChange } from "./mutations";
import { conflictDifferences, latestContact } from "./version-conflict";
import type { ContactConflict } from "./version-conflict";

const rowsPerPage = 10;

/**
 * 展示并管理指定客户的联系人和联系方式。
 * @param props 客户 ID 和页签栏右侧的新建按钮插槽。插槽未就绪时暂不显示按钮。
 * @returns 分页列表、编辑弹层和删除或版本冲突确认弹窗。
 */
export function CustomerContacts({
  customerId,
  addButtonSlot,
}: {
  customerId: string;
  addButtonSlot: HTMLDivElement | null;
}) {
  const [contacts, setContacts] = useState<CustomerContact[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<ContactEditorMode | null>(null);
  const [deletion, setDeletion] = useState<DeleteChange | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // 按联系方式展开和分页，无联系方式的联系人仍保留一行，方便继续添加。
  const rows = (contacts ?? []).flatMap((contact) =>
    (contact.methods.length ? contact.methods : [null]).map((method) => ({
      contact,
      method,
    }))
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * rowsPerPage;
  const visibleRows = rows.slice(pageStart, pageStart + rowsPerPage);

  useEffect(() => {
    setPage((previous) => Math.min(previous, pageCount));
  }, [pageCount]);

  useEffect(() => {
    // 切换客户或重新加载时取消上一笔请求，防止旧结果覆盖当前列表。
    const abort = new AbortController();
    void listCustomerContacts(customerId, abort.signal).then(
      ({ contacts: records }) => {
        if (!abort.signal.aborted) setContacts(records);
      },
      (error: unknown) => {
        if (!abort.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "暂时无法加载联系方式。"
          );
      }
    );
    return () => abort.abort();
  }, [customerId, loadAttempt]);

  function rememberContact(contact: CustomerContact) {
    setContacts((records) => {
      const items = records ?? [];
      return items.some((item) => item.id === contact.id)
        ? items.map((item) => (item.id === contact.id ? contact : item))
        : [...items, contact];
    });
  }

  function restoreFocus() {
    requestAnimationFrame(() => {
      // 删除后原按钮可能已离开页面，此时将焦点还给新建按钮。
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      else addButton.current?.focus();
    });
  }

  function closeEditor() {
    setEditor(null);
    setError("");
    restoreFocus();
  }

  function closeDelete() {
    setDeletion(null);
    setError("");
    restoreFocus();
  }

  function openEditor(mode: ContactEditorMode, button: HTMLButtonElement) {
    triggerRef.current = button;
    setError("");
    setEditor(mode);
  }

  /**
   * 提交联系人操作，用接口返回的记录更新列表，并处理失败提示和版本冲突。
   * @param change 待提交的新增、改名、编辑或删除操作。
   * @param expectedVersion 确认覆盖时使用的最新联系人版本，首次提交可省略。
   * @returns 操作处理完成时结束。请求错误会显示在页面或冲突弹窗中。
   */
  async function write(change: ContactChange, expectedVersion?: number) {
    // 同步标记阻止 React 状态更新前的重复提交。
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    setNotice("");

    try {
      const { contact } = await contactRequest(
        customerId,
        change,
        expectedVersion
      );
      rememberContact(contact);
      if (change.kind === "create") {
        setPage(
          Math.ceil((rows.length + contact.methods.length) / rowsPerPage)
        );
      }
      setConflict(null);
      setEditor(null);
      setDeletion(null);
      setNotice(
        change.kind === "delete" ? "已删除联系方式。" : "已保存联系方式。"
      );
      restoreFocus();
    } catch (error) {
      if (change.kind !== "create") {
        const latest = latestContact(error, change.contact.id);
        if (latest) {
          // 先展示最新数据，再决定原操作是否还能重试。
          rememberContact(latest);
          const methodId =
            change.kind === "edit"
              ? change.methodId
              : change.kind === "delete"
                ? change.method.id
                : undefined;
          if (
            methodId &&
            !latest.methods.some((method) => method.id === methodId)
          ) {
            setConflict(null);
            setDeletion(null);
            setError("该联系方式已被删除。");
            if (change.kind === "delete") restoreFocus();
            return;
          }
          if (
            change.kind === "add" &&
            latest.methods.some((method) => method.type === change.method.type)
          ) {
            setConflict(null);
            setError(
              `该联系人已有${contactMethodLabels[change.method.type]}，请选择其他方式或编辑已有联系方式。`
            );
            return;
          }
          setConflict({ change, latest });
          return;
        }
      }
      setConflict(null);
      setError(
        error instanceof Error ? error.message : "操作失败，请稍后重试。"
      );
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function openDelete(
    contact: CustomerContact,
    method: CustomerContactMethod,
    button: HTMLButtonElement
  ) {
    triggerRef.current = button;
    setError("");
    setDeletion({ kind: "delete", contact, method });
  }

  if (loadError) {
    return (
      <div className="flex flex-wrap items-center gap-3 py-4">
        <FieldError>{loadError}</FieldError>
        <Button
          variant="outline"
          onClick={() => {
            setLoadError("");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          重试
        </Button>
      </div>
    );
  }
  if (!contacts) {
    return (
      <Skeleton
        className="h-24 w-full"
        aria-label="正在加载联系方式"
        role="status"
      />
    );
  }

  return (
    <div className="space-y-4">
      {addButtonSlot &&
        createPortal(
          <Button
            ref={addButton}
            aria-label="添加联系方式"
            className="h-8 px-3"
            onClick={(event) =>
              openEditor({ kind: "add", contacts }, event.currentTarget)
            }
          >
            <Plus data-icon="inline-start" />
            新建
          </Button>,
          addButtonSlot
        )}
      {error && !editor && !deletion && <FieldError>{error}</FieldError>}
      <p className="sr-only" role="status">
        {notice}
      </p>

      {contacts.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ContactRound />
            </EmptyMedia>
            <EmptyTitle>暂无联系方式</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table aria-label="客户联系方式">
            <TableHeader>
              <TableRow>
                <TableHead className="h-10 w-[22%] px-2.5 text-muted-foreground">
                  联系人
                </TableHead>
                <TableHead className="h-10 w-[18%] px-2.5 text-muted-foreground">
                  联系方式
                </TableHead>
                <TableHead className="h-10 px-2.5 text-muted-foreground">
                  联系号码
                </TableHead>
                <TableHead className="h-10 w-28 px-2.5 text-right text-muted-foreground">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {visibleRows.map(({ contact, method }) => (
                <TableRow key={method?.id ?? contact.id}>
                  <TableCell className="h-14 px-2.5">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto max-w-48 px-0 font-medium"
                      title="编辑联系人"
                      onClick={(event) =>
                        openEditor(
                          { kind: "rename", contact },
                          event.currentTarget
                        )
                      }
                    >
                      <span className="truncate">{contact.name}</span>
                    </Button>
                  </TableCell>
                  <TableCell className="px-2.5">
                    {method ? (
                      <Badge>{contactMethodLabels[method.type]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-40 px-2.5 whitespace-normal wrap-anywhere">
                    {method ? (
                      <>
                        <span>{method.value}</span>
                        {method.isPrimary && (
                          <Badge
                            variant="secondary"
                            className="ml-2 align-middle"
                          >
                            主要
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        暂无联系方式
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-3 text-right">
                    {method ? (
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(event) =>
                            openEditor(
                              { kind: "edit", contact, method },
                              event.currentTarget
                            )
                          }
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={(event) =>
                            openDelete(contact, method, event.currentTarget)
                          }
                        >
                          删除
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(event) =>
                          openEditor(
                            {
                              kind: "add",
                              contacts,
                              selectedContactId: contact.id,
                            },
                            event.currentTarget
                          )
                        }
                      >
                        添加
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <CustomerPagination
            label="联系方式分页"
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}

      {editor && (
        <CustomerContactEditor
          mode={editor}
          pending={pending}
          locked={pending || conflict !== null}
          error={error}
          onClose={closeEditor}
          onSubmit={(change) => void write(change)}
        />
      )}
      <AlertDialog
        open={deletion !== null && conflict === null}
        onOpenChange={(open) => {
          if (!open && !pending) closeDelete();
        }}
      >
        {deletion && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除联系方式</AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                确定删除{deletion.contact.name}的
                {contactMethodLabels[deletion.method.type]}「
                {deletion.method.value}」吗？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldError>{error}</FieldError>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void write(deletion)}
              >
                {pending ? "正在删除…" : "确认删除"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <VersionConflictDialog
        differences={conflict ? conflictDifferences(conflict) : null}
        pending={pending}
        onCancel={() => {
          setConflict(null);
          if (deletion) closeDelete();
        }}
        onOverwrite={() => {
          // 以当前确认过的版本重试，期间若再次更新仍会收到冲突。
          if (conflict) void write(conflict.change, conflict.latest.version);
        }}
      />
    </div>
  );
}
