import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import {
  type Department,
  type PendingApplication,
  reviewDepartmentApplication,
} from "@/request/organization";

type Decision = "approve" | "reject";

type ApprovalAction =
  | { type: "refresh" }
  | { type: "review"; id: string; decision: Decision };

const submittedAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function PendingApplicationItem({
  application,
  busy,
  reviewing,
  onReview,
}: {
  application: PendingApplication;
  busy: boolean;
  reviewing?: Decision;
  onReview: (decision: Decision) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-medium [overflow-wrap:anywhere]">
          {application.name}
        </p>
        <p className="break-all text-muted-foreground">{application.email}</p>
        <p className="text-xs text-muted-foreground">
          申请于{" "}
          <time dateTime={application.submittedAt}>
            {submittedAtFormatter.format(new Date(application.submittedAt))}
          </time>
        </p>
      </div>
      <div
        className="flex shrink-0 flex-wrap gap-2"
        role="group"
        aria-label={`${application.name}的入部申请`}
      >
        <Button
          type="button"
          className="min-h-11 sm:min-h-8"
          variant="outline"
          disabled={busy}
          onClick={() => onReview("reject")}
        >
          {reviewing === "reject" ? "驳回中…" : "驳回"}
        </Button>
        <Button
          type="button"
          className="min-h-11 sm:min-h-8"
          disabled={busy}
          onClick={() => onReview("approve")}
        >
          {reviewing === "approve" ? "处理中…" : "通过"}
        </Button>
      </div>
    </li>
  );
}

export function DepartmentApprovals({
  department,
  applications,
}: {
  department: Department;
  applications: PendingApplication[];
}) {
  const router = useRouter();
  const [action, setAction] = useState<ApprovalAction | null>(null);
  const [error, setError] = useState("");
  const busy = action !== null;

  /**
   * 执行审核或刷新操作。审核成功后重新加载待审列表。
   * @param nextAction 刷新操作，或带申请 ID 和决定的审核操作。
   * @returns 操作结束后完成。失败时在当前页面显示错误。
   */
  async function run(nextAction: ApprovalAction) {
    if (busy) return;
    setAction(nextAction);
    setError("");
    try {
      if (nextAction.type === "review") {
        await reviewDepartmentApplication(nextAction.id, nextAction.decision);
      }
      await router.invalidate();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      setAction(null);
    }
  }

  return (
    <section
      aria-labelledby="department-approvals-heading"
      className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10"
    >
      <h1
        id="department-approvals-heading"
        className="text-3xl font-semibold tracking-tight"
      >
        入部审批
      </h1>
      <Card aria-busy={busy}>
        <CardHeader>
          <CardTitle className="min-w-0 [overflow-wrap:anywhere]">
            <h2>{department.name}</h2>
          </CardTitle>
          <CardDescription role="status">
            待审核申请 {applications.length} 条
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={() => void run({ type: "refresh" })}
            >
              {action?.type === "refresh" ? "刷新中…" : "刷新列表"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldError>{error}</FieldError>
          {applications.length === 0 ? (
            <p className="py-4 text-muted-foreground">暂无待审核申请。</p>
          ) : (
            <ul className="divide-y divide-border">
              {applications.map((application) => (
                <PendingApplicationItem
                  key={application.id}
                  application={application}
                  busy={busy}
                  reviewing={
                    action?.type === "review" && action.id === application.id
                      ? action.decision
                      : undefined
                  }
                  onReview={(decision) =>
                    void run({ type: "review", id: application.id, decision })
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
