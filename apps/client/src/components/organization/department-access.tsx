import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";
import { signOut } from "@/request/auth";
import {
  type Department,
  type Viewer,
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

  return (
    <AuthPageShell
      title={pending ? "等待审批" : "选择部门"}
      description={pending ? undefined : "提交后，由所选部门的主管审批。"}
    >
      <div className="space-y-4">
        {pending ? (
          <DepartmentApplicationStatus
            departmentName={application.department.name}
            busy={busy}
            onRefresh={() => void run(() => router.invalidate())}
          />
        ) : (
          <>
            {rejected && (
              <p className="text-sm text-muted-foreground" role="status">
                加入 {application.department.name}{" "}
                的申请未通过。你可以重新选择部门并提交。
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
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          className="min-h-11 w-full"
          variant="outline"
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
    </AuthPageShell>
  );
}
