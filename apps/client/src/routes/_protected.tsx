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
import { getAuthSession } from "@/request/auth";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const { data: session, error } = await getAuthSession();

    if (error) {
      throw new Error("无法检查登录状态");
    }

    if (!session) {
      throw redirect({ to: "/login", replace: true });
    }

    return { session };
  },
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { session } = Route.useRouteContext();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar account={session.user} />
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
        正在检查登录状态…
      </p>
    </main>
  );
}

function SessionError() {
  const router = useRouter();

  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">暂时无法检查登录状态</h1>
        <Button onClick={() => void router.invalidate()}>重试</Button>
      </div>
    </main>
  );
}
