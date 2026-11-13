import { useRouter } from "@tanstack/react-router";
import { type MouseEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import {
  type DepartmentRoster,
  appointDepartmentSupervisor,
  reviewDepartmentApplication,
} from "@/request/organization";

type PendingAccount = DepartmentRoster["pendingApplicants"][number] & {
  role: "pending";
};
type RosterAccount = DepartmentRoster["members"][number] | PendingAccount;
type ReviewDecision = "approve" | "reject";
type RosterAction = "appoint" | ReviewDecision;

const successMessages = {
  appoint: "主管已任命。",
  approve: "入部申请已通过。",
  reject: "入部申请已驳回。",
};

const roleLabels = {
  member: "普通成员",
  supervisor: "现任主管",
  pending: "待审批",
};

const roleStyles = {
  member: "bg-muted text-muted-foreground",
  supervisor: "bg-primary/10 text-foreground",
  pending: "border border-border text-muted-foreground",
};

export function DepartmentRosterCard({
  department,
}: {
  department: DepartmentRoster;
}) {
  const router = useRouter();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null
  );
  const [workingAction, setWorkingAction] = useState<{
    email: string;
    action: RosterAction;
  } | null>(null);
  const [actionError, setActionError] = useState<{
    email: string;
    message: string;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const supervisor = department.members.find(
    ({ role }) => role === "supervisor"
  );
  const busy = workingAction !== null;

  /**
   * 提交一项名册操作，成功后刷新路由数据并把焦点移到部门标题。
   * @param email 被操作账号的邮箱，用于定位状态和错误提示。
   * @param action 任命、批准或拒绝，用于显示操作状态和成功提示。
   * @param request 执行该操作的请求函数。
   * @returns 操作结束后完成。失败时在对应账号行显示错误。
   */
  async function runAction(
    email: string,
    action: RosterAction,
    request: () => Promise<unknown>
  ) {
    if (busy) return;
    setWorkingAction({ email, action });
    setActionError(null);
    setSuccessMessage("");

    try {
      await request();
      setConfirmationEmail(null);
      await router.invalidate({ sync: true });
      setSuccessMessage(successMessages[action]);
      headingRef.current?.focus();
    } catch (error) {
      setActionError({
        email,
        message:
          error instanceof Error ? error.message : "操作失败，请稍后重试。",
      });
    } finally {
      setWorkingAction(null);
    }
  }

  function appoint(email: string) {
    void runAction(email, "appoint", () =>
      appointDepartmentSupervisor(department.id, email)
    );
  }

  function review(account: PendingAccount, decision: ReviewDecision) {
    setConfirmationEmail(null);
    void runAction(account.email, decision, () =>
      reviewDepartmentApplication(account.applicationId, decision)
    );
  }

  /**
   * 开始任命主管。候选人待入部或部门已有主管时，先在对应行要求确认。
   * @param account 要任命的账号。
   * @param event 任命按钮的点击事件，用于记录取消后要恢复焦点的按钮。
   * @returns 无返回值。无需确认时直接发起任命请求。
   */
  function startAppointment(
    account: RosterAccount,
    event: MouseEvent<HTMLButtonElement>
  ) {
    setActionError(null);
    setSuccessMessage("");
    if (account.role === "pending" || supervisor) {
      confirmationTrigger.current = event.currentTarget;
      setConfirmationEmail(account.email);
      return;
    }

    setConfirmationEmail(null);
    appoint(account.email);
  }

  function cancelAppointment() {
    setConfirmationEmail(null);
    setActionError(null);
    confirmationTrigger.current?.focus();
  }

  function renderAccount(account: RosterAccount) {
    const { id, name, email, role } = account;
    const confirming = confirmationEmail === email;
    const saving = workingAction?.email === email ? workingAction.action : null;
    const error = actionError?.email === email ? actionError.message : null;
    const actionLabel = role === "pending" ? "通过并任命" : "任命主管";

    return (
      <li key={id} className="px-4 py-3">
        <div
          className={
            role === "pending"
              ? "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              : "flex min-w-0 items-center justify-between gap-3"
          }
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 wrap-anywhere font-medium">{name}</p>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleStyles[role]}`}
              >
                {roleLabels[role]}
              </span>
            </div>
            <p className="wrap-anywhere text-sm text-muted-foreground">
              {email}
            </p>
          </div>
          {role !== "supervisor" && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {account.role === "pending" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:min-h-8"
                    aria-label={`驳回（${name}）`}
                    disabled={busy}
                    onClick={() => review(account, "reject")}
                  >
                    {saving === "reject" ? "驳回中…" : "驳回"}
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11 sm:min-h-8"
                    aria-label={`通过（${name}）`}
                    disabled={busy}
                    onClick={() => review(account, "approve")}
                  >
                    {saving === "approve" ? "通过中…" : "通过"}
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-8"
                aria-label={`${actionLabel}（${name}）`}
                aria-expanded={
                  role === "pending" || supervisor ? confirming : undefined
                }
                disabled={busy}
                onClick={(event) => startAppointment(account, event)}
              >
                {saving === "appoint" ? "正在任命…" : actionLabel}
              </Button>
            </div>
          )}
        </div>
        {confirming && (
          <div className="mt-3 flex flex-col items-start gap-3 rounded-lg bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className="min-w-0 wrap-anywhere text-sm text-muted-foreground"
              role="status"
            >
              {role === "pending" && "此操作也会通过入部申请。"}
              {supervisor && `现任主管 ${supervisor.name} 将恢复为普通成员。`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={cancelAppointment}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => appoint(email)}
              >
                {saving === "appoint" ? "正在任命…" : "确认任命"}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-2">
            <FieldError>{error}</FieldError>
          </div>
        )}
      </li>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle>
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="wrap-anywhere"
            >
              {department.name}
            </h2>
          </CardTitle>
          <p
            className="text-sm text-muted-foreground empty:sr-only"
            role="status"
          >
            {successMessage}
          </p>
        </CardHeader>
        <CardContent className="px-0">
          {department.members.length === 0 ? (
            <p className="px-4 py-3 text-muted-foreground">暂无成员。</p>
          ) : (
            <ul className="divide-y divide-border">
              {department.members.map(renderAccount)}
            </ul>
          )}
          {department.pendingApplicants.length > 0 && (
            <div className="border-t">
              <h3 className="px-4 pt-3 text-sm font-medium">待审申请</h3>
              <ul className="divide-y divide-border">
                {department.pendingApplicants.map((account) =>
                  renderAccount({ ...account, role: "pending" })
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
