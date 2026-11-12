import {
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canEnterWorkspace } from "@/lib/auth/workspace-access";
import { getViewer } from "@/request/organization";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const viewer = await getViewer();
    if (!viewer) {
      throw redirect({ to: "/login", replace: true });
    }
    if (!canEnterWorkspace(viewer)) {
      throw redirect({ to: "/department-access", replace: true });
    }
    return { viewer };
  },
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { viewer } = Route.useRouteContext();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar account={viewer.account} />
        <SidebarInset className="min-w-0 bg-muted/30">
          <header className="flex h-14 shrink-0 items-center border-b bg-background px-4">
            <SidebarTrigger aria-label="切换侧边栏" />
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function SessionPending() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <p className="text-sm text-muted-foreground" role="status">
        正在检查工作台权限…
      </p>
    </main>
  );
}

function SessionError() {
  const router = useRouter();

  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">暂时无法检查工作台权限</h1>
        <Button onClick={() => void router.invalidate()}>重试</Button>
      </div>
    </main>
  );
}
