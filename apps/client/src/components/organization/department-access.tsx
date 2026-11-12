import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { canEnterWorkspace } from "@/lib/auth/workspace-access";
import { signOut } from "@/request/auth";
import {
  type Department,
  type Viewer,
  getViewer,
  submitDepartmentApplication,
} from "@/request/organization";

import { DepartmentApplicationForm } from "./department-application-form";
import { DepartmentApplicationStatus } from "./department-application-status";

export function DepartmentAccess({
  viewer,
  departments,
}: {
  viewer: Viewer;
  departments: Department[];
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedApplicationId, setCheckedApplicationId] = useState<
    string | null
  >(null);
  const { application } = viewer;
  const pending = application?.status === "pending";
  const rejected = application?.status === "rejected";

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      setBusy(false);
    }
  }

  function checkApproval() {
    return run(async () => {
      setCheckedApplicationId(null);
      const latestViewer = await getViewer().catch(() => {
        throw new Error("暂时无法检查审批结果，请重试。");
      });

      if (
        latestViewer?.application?.status === "pending" &&
        latestViewer.application.id === application?.id &&
        !canEnterWorkspace(latestViewer)
      ) {
        setCheckedApplicationId(latestViewer.application.id);
        return;
      }

      await router.invalidate({ sync: true });
    });
  }

  return (
    <AuthPageShell
      title={pending ? "等待审批" : "选择部门"}
      description={pending ? undefined : "提交后由所选部门的主管审批。"}
    >
      <div className="space-y-4">
        {pending ? (
          <DepartmentApplicationStatus
            departmentName={application.department.name}
            busy={busy}
            checked={checkedApplicationId === application.id}
            onRefresh={() => void checkApproval()}
          />
        ) : (
          <>
            {rejected && (
              <p
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
                role="status"
              >
                加入 {application.department.name} 的申请未通过，请重新提交。
              </p>
            )}
            <DepartmentApplicationForm
              departments={departments}
              defaultDepartmentId={
                rejected ? application.department.id : undefined
              }
              busy={busy}
              onSubmit={(departmentId) =>
                void run(async () => {
                  await submitDepartmentApplication(departmentId);
                  await router.invalidate();
                })
              }
            />
          </>
        )}
        <FieldError>{error}</FieldError>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <p className="min-w-0 break-all text-xs text-muted-foreground">
            <span className="sr-only">当前账号 </span>
            {viewer.account.email}
          </p>
          <Button
            type="button"
            className="min-h-11"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await signOut();
                if (error) throw new Error("退出登录失败，请重试。");
                await navigate({ to: "/login", replace: true });
              })
            }
          >
            退出登录
          </Button>
        </div>
      </div>
    </AuthPageShell>
  );
}
