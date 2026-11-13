import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { DepartmentAccess } from "@/components/organization/department-access";
import { Button } from "@/components/ui/button";
import { canEnterWorkspace } from "@/lib/auth/workspace-access";
import { getViewer, listDepartments } from "@/request/organization";

export const Route = createFileRoute("/department-access/")({
  beforeLoad: async () => {
    const viewer = await getViewer();
    if (!viewer) throw redirect({ to: "/login", replace: true });
    if (canEnterWorkspace(viewer)) throw redirect({ to: "/", replace: true });
    return { viewer };
  },
  // 待审时只展示申请状态，等能再次选择部门时才请求部门列表。
  loader: ({ context }) =>
    context.viewer.application?.status === "pending" ? [] : listDepartments(),
  component: DepartmentAccessRoute,
  errorComponent: DepartmentAccessError,
});

function DepartmentAccessRoute() {
  const { viewer } = Route.useRouteContext();
  return (
    <DepartmentAccess viewer={viewer} departments={Route.useLoaderData()} />
  );
}

function DepartmentAccessError() {
  const router = useRouter();
  return (
    <AuthPageShell title="暂时无法加载入部信息">
      <Button className="w-full" onClick={() => void router.invalidate()}>
        重试
      </Button>
    </AuthPageShell>
  );
}
