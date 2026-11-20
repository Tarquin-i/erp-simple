import { getRouteApi } from "@tanstack/react-router";
import { ContactRound, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualList } from "@/components/ui/virtual-list";
import { CustomerApiError, listCustomerContacts } from "@/request/customers";
import type {
  CustomerContact,
  CustomerContactMethod,
} from "@/request/customers";

import { VersionConflictDialog } from "../../version-conflict-dialog";
import { CustomerContactEditor } from "./contact-editor";
import type { ContactEditorMode } from "./contact-editor";
import { ContactGroup } from "./contact-group";
import { ContactManagerDialog } from "./contact-manager-dialog";
import { contactMethodLabels } from "./method-labels";
import { isPhoneMethod, sameContactValue } from "./method-value";
import { contactRequest, restoreContactRequest } from "./mutations";
import type {
  ContactChange,
  ContactEditSnapshot,
  DeleteChange,
} from "./mutations";
import {
  conflictDifferences,
  contactOverwriteError,
  latestContact,
  normalizeContactOverwrite,
} from "./version-conflict";
import type { ContactConflict } from "./version-conflict";

const workspaceRoute = getRouteApi("/_protected");

/**
 * 展示并管理指定客户的联系人和联系方式。
 * @param props 客户 ID 和页签栏右侧的新建按钮插槽。插槽未就绪时暂不显示按钮。
 * @returns 联系人滚动列表、编辑弹层和删除或版本冲突确认弹窗。
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
  const [managedContactId, setManagedContactId] = useState<string | null>(null);
  const [focusReturnId, setFocusReturnId] = useState<string>();
  const [editor, setEditor] = useState<ContactEditorMode | null>(null);
  const [deletion, setDeletion] = useState<DeleteChange | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const [operation, setOperation] = useState<"save" | "restore" | null>(null);
  const [error, setError] = useState("");
  const [retryingCreation, setRetryingCreation] = useState(false);
  const [notice, setNotice] = useState<{ text: string; visible?: boolean }>();
  const writing = useRef(false);
  const contactIdsBeforeRefresh = useRef<ReadonlySet<string> | null>(null);
  const restoredContact = useRef<CustomerContact | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const managerTrigger = useRef<HTMLButtonElement>(null);
  const managerAddButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editorContent = useRef<HTMLDivElement>(null);
  const editorInput = useRef<HTMLInputElement>(null);
  const pending = operation !== null;
  const managedContact = contacts?.find(
    (contact) => contact.id === managedContactId
  );
  const activeContactId =
    managedContactId ??
    (editor && editor.kind !== "create" ? editor.contact.id : undefined);
  const retainedContactId = activeContactId ?? focusReturnId;
  const retainedIds = useMemo(
    () => (retainedContactId ? new Set([retainedContactId]) : undefined),
    [retainedContactId]
  );
  const overwriteError = conflict ? contactOverwriteError(conflict) : undefined;

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

  /**
   * 同步新增联系方式表单中的联系人资料，保留用户输入。
   * @param latest 后端返回的联系人快照，含最新版本和联系方式选项。
   * @returns 无返回值。仅替换对应联系人的资料。
   */
  function updateEditorContact(latest: CustomerContact) {
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
      if (triggerRef.current?.isConnected)
        triggerRef.current.focus({ preventScroll });
      // 原按钮可能已离开渲染范围，焦点回到弹窗的添加按钮。
      else if (managerAddButton.current) managerAddButton.current.focus();
      else addButton.current?.focus({ preventScroll });
      setFocusReturnId(undefined);
    });
  }

  function openManager(contactId: string, trigger: HTMLButtonElement) {
    managerTrigger.current = trigger;
    setError("");
    setManagedContactId(contactId);
  }

  function closeManager() {
    triggerRef.current = managerTrigger.current;
    setManagedContactId(null);
    setError("");
    restoreFocus();
  }

  function reloadContacts() {
    setContacts(null);
    setLoadError("");
    setScrollToId(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  }

  function closeEditor() {
    restoredContact.current = null;
    setEditor(null);
    setError("");
    setRetryingCreation(false);
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

  function closeDelete() {
    setDeletion(null);
    setError("");
    restoreFocus();
  }

  function openEditor(mode: ContactEditorMode, button: HTMLButtonElement) {
    triggerRef.current = button;
    restoredContact.current = null;
    setError("");
    setEditor(mode);
    if (managedContact) {
      requestAnimationFrame(() => editorInput.current?.focus());
    }
  }

  function submitEditor(change: ContactChange) {
    void write(change, restoredContact.current ?? undefined);
  }

  /**
   * 提交联系人操作，用接口返回的记录更新列表，并处理失败提示和版本冲突。
   * @param change 待提交的新增、改名、编辑或删除操作。
   * @param versionFrom 已核对的远端快照或上一笔写回后的快照，首次保存可以省略。
   * @param restoreFrom 点选写回旧值时传编辑打开时的快照，草稿仍留在表单上。
   * @returns 操作处理完成时结束。请求错误会显示在页面或冲突弹窗中。
   */
  async function write(
    change: ContactChange,
    versionFrom?: CustomerContact,
    restoreFrom?: ContactEditSnapshot
  ) {
    // 同步标记阻止 React 状态更新前的重复提交。
    if (writing.current) return;
    writing.current = true;
    setOperation(restoreFrom ? "restore" : "save");
    setError("");
    setNotice(undefined);

    const afterRestore = restoredContact.current !== null;
    try {
      const { contact } =
        restoreFrom && versionFrom
          ? await restoreContactRequest(customerId, restoreFrom, versionFrom)
          : await contactRequest(customerId, change, versionFrom, afterRestore);
      rememberContact(contact);
      if (restoreFrom) {
        // 两笔写入各自校验。只更新下次保存所用的版本，表单保留原草稿。
        restoredContact.current = contact;
        setConflict(null);
        return;
      }
      restoredContact.current = null;
      if (change.kind === "create") {
        setScrollToId(contact.id);
      }
      setConflict(null);
      setEditor(null);
      setRetryingCreation(false);
      setDeletion(null);
      setNotice({
        text:
          change.kind === "delete" ? "已删除联系方式。" : "已保存联系方式。",
      });
      restoreFocus(change.kind === "create");
    } catch (error) {
      if (change.kind === "create") {
        const uncertain =
          !(error instanceof CustomerApiError) ||
          error.status >= 500 ||
          error.status === 408 ||
          error.status === 429 ||
          error.code === "idempotency_conflict";
        if (retryingCreation || uncertain) {
          setRetryingCreation(true);
          setError(
            error instanceof CustomerApiError &&
              [401, 403, 404, 409].includes(error.status)
              ? error.message
              : "暂时无法确认保存结果，请再次点击保存以重试原提交。"
          );
          return;
        }
      }
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
          const currentMethod = latest.methods.find(
            (method) => method.id === methodId
          );
          if (methodId && !currentMethod) {
            setConflict(null);
            closeEditor();
            setDeletion(null);
            setError(
              afterRestore || restoreFrom
                ? "该联系方式已被删除，草稿已丢弃。"
                : "该联系方式已被删除。"
            );
            return;
          }
          if (
            change.kind === "add" &&
            latest.methods.some((method) => method.type === change.method.type)
          ) {
            setConflict(null);
            // 追加方式遇到重复类型时更新选项和联系人版本，供重新选择。
            updateEditorContact(latest);
            setError(
              `该联系人已有${contactMethodLabels[change.method.type]}，请选择其他方式或编辑已有联系方式。${change.method.isPrimary ? "改选后如需设为主要联系方式，请重新勾选。" : ""}`
            );
            return;
          }
          let pendingChange = normalizeContactOverwrite(change, currentMethod);
          const comparisonBase = versionFrom ?? change.contact;
          let phoneValueAlreadyApplied = false;
          let primaryAlreadyApplied = false;
          if (
            pendingChange.kind === "edit" &&
            currentMethod &&
            !afterRestore &&
            !restoreFrom
          ) {
            const { isPrimary, type, value } = pendingChange.fields;
            primaryAlreadyApplied = isPrimary === currentMethod.isPrimary;
            const sameType = type === undefined || type === currentMethod.type;
            const sameValue =
              value !== undefined &&
              sameContactValue(
                sameType ? currentMethod.type : "",
                value,
                currentMethod.value
              );
            phoneValueAlreadyApplied =
              sameType && isPhoneMethod(currentMethod.type) && sameValue;
            if (phoneValueAlreadyApplied || primaryAlreadyApplied) {
              const fields = {
                ...(sameType ? {} : { type }),
                ...(sameValue || value === undefined ? {} : { value }),
                ...(isPrimary !== undefined && !primaryAlreadyApplied
                  ? { isPrimary }
                  : {}),
              };
              if (Object.keys(fields).length === 0) {
                setConflict(null);
                closeEditor();
                let text = "最新联系方式已包含你的修改。";
                if (primaryAlreadyApplied)
                  text = isPrimary
                    ? `${contactMethodLabels[currentMethod.type]}已设为主要联系方式。`
                    : "主要联系方式标记已取消。";
                setNotice({
                  text,
                  visible: true,
                });
                return;
              }
              pendingChange = { ...pendingChange, fields };
            }
          }
          setConflict({
            change: {
              ...pendingChange,
              contact: comparisonBase,
            },
            draftChange: change,
            latest,
            primaryAlreadyApplied,
            phoneValueAlreadyApplied,
          });
          return;
        }
      }
      setConflict(null);
      const message =
        error instanceof Error ? error.message : "操作失败，请稍后重试。";
      if (afterRestore || restoreFrom) {
        closeEditor();
        setError(`${message} 草稿已丢弃，请刷新后查看最新资料。`);
      } else {
        setError(message);
      }
    } finally {
      writing.current = false;
      setOperation(null);
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

  const editorForm = editor && (
    <CustomerContactEditor
      accountId={viewer.account.id}
      embedded={Boolean(managedContact)}
      mode={editor}
      restored={restoredContact.current !== null}
      contentRef={editorContent}
      inputRef={editorInput}
      pending={pending}
      locked={pending || conflict !== null}
      retryingCreation={retryingCreation}
      error={error}
      onClose={closeEditor}
      onSubmit={submitEditor}
    />
  );

  return (
    <div className="space-y-4">
      {addButtonSlot &&
        createPortal(
          <Button
            ref={addButton}
            aria-label="新建联系人"
            className="h-8 px-3"
            onClick={(event) =>
              openEditor({ kind: "create" }, event.currentTarget)
            }
          >
            <Plus data-icon="inline-start" />
            新建
          </Button>,
          addButtonSlot
        )}
      {error && !managedContact && !editor && !deletion && (
        <FieldError>{error}</FieldError>
      )}
      <p
        className={
          notice?.visible ? "text-muted-foreground text-sm" : "sr-only"
        }
        role="status"
      >
        {notice?.text}
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
              onManage={(trigger) => openManager(contact.id, trigger)}
              onAdd={(trigger) => openEditor({ kind: "add", contact }, trigger)}
            />
          )}
        />
      )}

      {managedContact ? (
        <ContactManagerDialog
          contact={managedContact}
          title={
            editor?.kind === "edit"
              ? "编辑联系方式"
              : editor?.kind === "add"
                ? "添加联系方式"
                : "编辑联系人"
          }
          form={editorForm}
          locked={pending || conflict !== null || deletion !== null}
          error={deletion ? "" : error}
          contentRef={editorContent}
          addButtonRef={managerAddButton}
          onClose={editor ? closeEditor : closeManager}
          onRename={(trigger) =>
            openEditor({ kind: "rename", contact: managedContact }, trigger)
          }
          onAdd={(trigger) =>
            openEditor({ kind: "add", contact: managedContact }, trigger)
          }
          onEdit={(method, trigger) =>
            openEditor(
              { kind: "edit", contact: managedContact, method },
              trigger
            )
          }
          onDelete={(method, trigger) =>
            openDelete(managedContact, method, trigger)
          }
        />
      ) : (
        editorForm
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
        description={
          overwriteError ??
          "比较当前资料和保存后的变化。若主要联系方式会变化，表格会列出变更前后的主要项。"
        }
        pending={pending}
        pendingLabel={operation === "restore" ? "正在写回旧值…" : undefined}
        overwriteBlocked={Boolean(overwriteError)}
        onCancel={() => {
          // 新增时同步可选项。关闭已有资料的冲突弹窗不写库，也不接受新版本。
          if (conflict?.change.kind === "add") {
            updateEditorContact(conflict.latest);
          }
          setConflict(null);
          if (deletion) closeDelete();
        }}
        onCloseAutoFocus={(event) => {
          if (!editorInput.current) return;
          event.preventDefault();
          // 等冲突弹窗释放焦点后，再回到仍打开的编辑表单。
          requestAnimationFrame(() => editorInput.current?.focus());
        }}
        onRestore={
          conflict &&
          (conflict.change.kind === "edit" ||
            conflict.change.kind === "rename") &&
          (editor?.kind === "edit" || editor?.kind === "rename")
            ? () => void write(conflict.draftChange, conflict.latest, editor)
            : undefined
        }
        onOverwrite={() => {
          // 以当前确认过的版本重试，期间若再次更新仍会收到冲突。
          if (conflict && !overwriteError)
            void write(conflict.change, conflict.latest);
        }}
      />
    </div>
  );
}
