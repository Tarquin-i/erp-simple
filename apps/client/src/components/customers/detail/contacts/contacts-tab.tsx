import { getRouteApi } from "@tanstack/react-router";
import { ContactRound, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { VersionConflictDialog } from "@/components/shared/version-conflict-dialog";
import { VirtualList } from "@/components/shared/virtual-list";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  archiveCustomerContact,
  CustomerApiError,
  listCustomerContacts,
} from "@/request/customers";
import type { ContactFormDraft, CustomerContact } from "@/request/customers";

import { CustomerContactEditor } from "./contact-editor";
import { ContactGroup } from "./contact-group";
import { ContactManagerDialog } from "./contact-manager-dialog";
import { contactMethodDuplicateError } from "./method-value";
import { contactRequest } from "./mutations";
import type { ContactChange } from "./mutations";
import { latestContact, prepareContactOverwrite } from "./version-conflict";
import type { ContactConflict } from "./version-conflict";

const workspaceRoute = getRouteApi("/_protected");

type EditorMode =
  | { kind: "create" }
  | { kind: "edit" | "add"; contact: CustomerContact };

/**
 * 展示并管理指定客户的联系人和联系方式。
 * @param props 客户 ID 和页签栏右侧的新建按钮插槽。插槽未就绪时暂不显示按钮。
 * @returns 联系人滚动列表、编辑弹层和归档或版本冲突确认弹窗。
 */
export function CustomerContacts({
  customerId,
  addButtonSlot,
}: {
  customerId: string;
  addButtonSlot: HTMLDivElement | null;
}) {
  const { viewer } = workspaceRoute.useRouteContext();
  const [contacts, setContacts] = useState<CustomerContact[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [scrollToId, setScrollToId] = useState<string>();
  const [focusReturnId, setFocusReturnId] = useState<string>();
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [archiving, setArchiving] = useState<CustomerContact | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retryingCreation, setRetryingCreation] = useState(false);
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const contactIdsBeforeRefresh = useRef<ReadonlySet<string> | null>(null);
  const createAttempt = useRef<Extract<
    ContactChange,
    { kind: "create" }
  > | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editorInput = useRef<HTMLInputElement>(null);
  const activeContactId =
    archiving?.id ??
    (editor && editor.kind !== "create" ? editor.contact.id : undefined);
  const retainedContactId = activeContactId ?? focusReturnId;
  const retainedIds = useMemo(
    () => (retainedContactId ? new Set([retainedContactId]) : undefined),
    [retainedContactId]
  );
  const overwrite = conflict ? prepareContactOverwrite(conflict) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies(loadAttempt): 重试或主动刷新时重新加载当前客户的联系人。
  useEffect(() => {
    // 切换客户或重新加载时取消上一笔请求，防止旧结果覆盖当前列表。
    const abort = new AbortController();
    void listCustomerContacts(customerId, abort.signal).then(
      ({ contacts: records }) => {
        if (abort.signal.aborted) return;
        const previousIds = contactIdsBeforeRefresh.current;
        contactIdsBeforeRefresh.current = null;
        if (previousIds) {
          // 列表按创建时间升序返回，优先定位刷新后发现的最新联系人。
          for (let index = records.length - 1; index >= 0; index--) {
            const { id } = records[index];
            if (!previousIds.has(id)) {
              setScrollToId(id);
              break;
            }
          }
        }
        setContacts(records);
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

  function updateAddContact(latest: CustomerContact) {
    setEditor((mode) =>
      mode?.kind === "add" && mode.contact.id === latest.id
        ? { ...mode, contact: latest }
        : mode
    );
  }

  function restoreFocus(preventScroll = false) {
    // 弹窗关闭后仍需保留原行，直到它重新获得焦点。
    setFocusReturnId(activeContactId);
    requestAnimationFrame(() => {
      const button = trigger.current?.isConnected
        ? trigger.current
        : addButton.current;
      button?.focus({ preventScroll });
      setFocusReturnId(undefined);
    });
  }

  function reloadContacts() {
    setContacts(null);
    setLoadError("");
    setScrollToId(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  }

  function closeEditor() {
    setEditor(null);
    setError("");
    setRetryingCreation(false);
    createAttempt.current = null;
    if (retryingCreation) {
      // 上一次新建可能已经保存，刷新完成后再显示新建入口。
      contactIdsBeforeRefresh.current = contacts
        ? new Set(contacts.map(({ id }) => id))
        : null;
      reloadContacts();
    } else {
      restoreFocus();
    }
  }

  function openEditor(mode: EditorMode, button: HTMLButtonElement) {
    trigger.current = button;
    setError("");
    setEditor(mode);
  }

  function submitManagedDraft(draft: ContactFormDraft) {
    if (!editor || writing.current) return;
    if (editor.kind === "edit") {
      void write({ kind: "edit", contact: editor.contact, draft });
    } else if (editor.kind === "create") {
      // 结果不确定时直接重试已经发送的资料、账号和提交 ID。
      const change =
        (retryingCreation && createAttempt.current) ||
        ({
          kind: "create",
          draft: {
            name: draft.name,
            methods: draft.methods.map(({ type, value, isPrimary }) => ({
              type,
              value,
              isPrimary,
            })),
          },
          submission: { id: crypto.randomUUID(), accountId: viewer.account.id },
        } satisfies Extract<ContactChange, { kind: "create" }>);
      createAttempt.current = change;
      void write(change);
    }
  }

  async function write(
    change: ContactChange,
    versionFrom?: CustomerContact,
    confirmedChange = change
  ) {
    // 同步标记阻止 React 状态更新前的重复提交。
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const { contact } = await contactRequest(
        customerId,
        confirmedChange,
        versionFrom
      );
      rememberContact(contact);
      if (change.kind === "create") setScrollToId(contact.id);
      setConflict(null);
      setEditor(null);
      setRetryingCreation(false);
      createAttempt.current = null;
      setNotice("已保存联系方式。");
      restoreFocus(change.kind === "create");
    } catch (failure) {
      if (change.kind === "create") {
        const uncertain =
          !(failure instanceof CustomerApiError) ||
          failure.status >= 500 ||
          failure.status === 408 ||
          failure.status === 429 ||
          failure.code === "idempotency_conflict";
        if (retryingCreation || uncertain) {
          setRetryingCreation(true);
          setError(
            failure instanceof CustomerApiError &&
              [401, 403, 404, 409].includes(failure.status)
              ? failure.message
              : "暂时无法确认保存结果，请再次点击保存以重试原提交。"
          );
          return;
        }
      } else {
        const latest = latestContact(failure, change.contact.id);
        if (latest) {
          rememberContact(latest);
          if (change.kind === "add") {
            const duplicate = contactMethodDuplicateError(
              change.method,
              latest.methods
            );
            if (duplicate) {
              updateAddContact(latest);
              setConflict(null);
              setError(duplicate);
              return;
            }
          }
          // 保留原草稿，后续每次冲突仍相对打开表单时的版本比较。
          setConflict({ change, latest });
          return;
        }
      }
      setConflict(null);
      if (
        change.kind === "edit" &&
        failure instanceof CustomerApiError &&
        failure.status === 413
      ) {
        setError("本次改动超过请求大小限制，草稿已保留。请减少改动后再保存。");
        return;
      }
      setError(
        failure instanceof Error ? failure.message : "操作失败，请稍后重试。"
      );
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function closeArchive() {
    setArchiving(null);
    setError("");
    restoreFocus();
  }

  async function archiveContact(contact: CustomerContact) {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    setNotice("");

    const removeFromList = () =>
      setContacts(
        (records) => records?.filter(({ id }) => id !== contact.id) ?? null
      );

    try {
      await archiveCustomerContact(customerId, contact.id, contact.version);
      removeFromList();
      closeArchive();
      setNotice("已归档联系人。");
    } catch (failure) {
      const latest = latestContact(failure, contact.id);
      if (latest) {
        rememberContact(latest);
        closeArchive();
        setError("联系人资料已更新，请核对最新联系方式后重新归档。");
        return;
      }
      if (failure instanceof CustomerApiError && failure.status === 404) {
        removeFromList();
        closeArchive();
        setError(failure.message);
        return;
      }
      setError(
        failure instanceof CustomerApiError &&
          failure.status < 500 &&
          ![408, 429].includes(failure.status)
          ? failure.message
          : "暂时无法确认归档结果，请重试原提交。"
      );
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-wrap items-center gap-3 py-4">
        <FieldError>{loadError}</FieldError>
        <Button variant="outline" onClick={reloadContacts}>
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

  const locked = pending || conflict !== null;
  return (
    <div className="space-y-4">
      {addButtonSlot &&
        createPortal(
          <Button
            ref={addButton}
            type="button"
            size="icon"
            aria-label="新建联系人"
            title="新建联系人"
            onClick={(event) =>
              openEditor({ kind: "create" }, event.currentTarget)
            }
          >
            <Plus aria-hidden="true" />
          </Button>,
          addButtonSlot
        )}
      {error && !editor && !archiving && <FieldError>{error}</FieldError>}
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
        <VirtualList
          label="客户联系方式"
          items={contacts}
          estimateSize={(contact) =>
            36 +
            (collapsedIds.has(contact.id)
              ? 0
              : Math.max(1, contact.methods.length) * 40)
          }
          retainedIds={retainedIds}
          scrollToId={scrollToId}
          renderItem={(contact) => (
            <ContactGroup
              contact={contact}
              expanded={!collapsedIds.has(contact.id)}
              onExpandedChange={(expanded) =>
                setCollapsedIds((previous) => {
                  const next = new Set(previous);
                  if (expanded) next.delete(contact.id);
                  else next.add(contact.id);
                  return next;
                })
              }
              onManage={(button) =>
                openEditor({ kind: "edit", contact }, button)
              }
              onAdd={(button) => openEditor({ kind: "add", contact }, button)}
              onArchive={(button) => {
                trigger.current = button;
                setError("");
                setArchiving(contact);
              }}
            />
          )}
        />
      )}

      {editor?.kind === "add" ? (
        <CustomerContactEditor
          key={editor.contact.id}
          contact={editor.contact}
          inputRef={editorInput}
          pending={pending}
          locked={locked}
          error={error}
          onClose={closeEditor}
          onSubmit={(method) =>
            void write({ kind: "add", contact: editor.contact, method })
          }
        />
      ) : editor ? (
        <ContactManagerDialog
          key={editor.kind === "create" ? "create" : editor.contact.id}
          contact={editor.kind === "edit" ? editor.contact : undefined}
          nameInputRef={editorInput}
          pending={pending}
          locked={locked}
          retryOnly={retryingCreation}
          error={error}
          onClose={closeEditor}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onSave={submitManagedDraft}
        />
      ) : null}

      <AlertDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open && !pending) closeArchive();
        }}
      >
        {archiving && (
          <AlertDialogContent
            className="w-[calc(100%-2rem)]"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>归档联系人</AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                「{archiving.name}」和全部联系方式将一起移出联系人列表。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldError>{error}</FieldError>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void archiveContact(archiving)}
              >
                {pending ? "正在归档…" : "确认归档"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <VersionConflictDialog
        differences={overwrite?.differences ?? null}
        description={
          overwrite?.error ??
          "比较当前资料和保存后的变化。确认后会将你的修改合入最新资料。"
        }
        pending={pending}
        overwriteBlocked={Boolean(overwrite?.error)}
        onCancel={() => {
          if (conflict?.change.kind === "add")
            updateAddContact(conflict.latest);
          setConflict(null);
        }}
        onCloseAutoFocus={(event) => {
          if (!editorInput.current) return;
          event.preventDefault();
          requestAnimationFrame(() => editorInput.current?.focus());
        }}
        onOverwrite={() => {
          if (conflict && overwrite && !overwrite.error)
            void write(conflict.change, conflict.latest, overwrite.change);
        }}
      />
    </div>
  );
}
