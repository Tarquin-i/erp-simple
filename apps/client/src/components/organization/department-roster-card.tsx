import { useRouter } from "@tanstack/react-router";
import { type MouseEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import {
  type DepartmentRoster,
  appointDepartmentSupervisor,
} from "@/request/organization";

type RosterAccount =
  | DepartmentRoster["members"][number]
  | (DepartmentRoster["pendingApplicants"][number] & { role: "pending" });

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
  const [workingEmail, setWorkingEmail] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    email: string;
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const supervisor = department.members.find(
    ({ role }) => role === "supervisor"
  );
  const busy = workingEmail !== null;

  async function appoint(email: string) {
    if (busy) return;
    setWorkingEmail(email);
    setFeedback(null);

    try {
      await appointDepartmentSupervisor(department.id, email);
      setConfirmationEmail(null);
      await router.invalidate({ sync: true });
      setFeedback({ email, kind: "success", message: "主管已任命。" });
      headingRef.current?.focus();
    } catch (error) {
      setFeedback({
        email,
        kind: "error",
        message:
          error instanceof Error ? error.message : "任命失败，请稍后重试。",
      });
    } finally {
      setWorkingEmail(null);
    }
  }

  function startAppointment(
    account: RosterAccount,
    event: MouseEvent<HTMLButtonElement>
  ) {
    setFeedback(null);
    if (account.role === "pending" || supervisor) {
      confirmationTrigger.current = event.currentTarget;
      setConfirmationEmail(account.email);
      return;
    }

    setConfirmationEmail(null);
    void appoint(account.email);
  }

  function cancelAppointment() {
    setConfirmationEmail(null);
    setFeedback(null);
    confirmationTrigger.current?.focus();
  }

  function renderAccount(account: RosterAccount) {
    const { id, name, email, role } = account;
    const confirming = confirmationEmail === email;
    const saving = workingEmail === email;
    const result = feedback?.email === email ? feedback : null;
    const actionLabel = role === "pending" ? "通过并任命" : "任命主管";

    return (
      <li key={id} className="px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
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
            <Button
              type="button"
              variant="outline"
              className="min-h-10 sm:min-h-8"
              aria-label={`${actionLabel}（${name}）`}
              aria-expanded={
                role === "pending" || supervisor ? confirming : undefined
              }
              disabled={busy}
              onClick={(event) => startAppointment(account, event)}
            >
              {saving ? "正在任命…" : actionLabel}
            </Button>
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
                onClick={() => void appoint(email)}
              >
                {saving ? "正在任命…" : "确认任命"}
              </Button>
            </div>
          </div>
        )}
        {result && (
          <div className="mt-2">
            {result.kind === "error" ? (
              <FieldError>{result.message}</FieldError>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {result.message}
              </p>
            )}
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
