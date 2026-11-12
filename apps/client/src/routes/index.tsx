import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthSession } from "@/request/auth";

export const Route = createFileRoute("/")({
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
  pendingComponent: HomePending,
  errorComponent: HomeError,
  component: Home,
});

function Home() {
  const { session } = Route.useRouteContext();

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center px-6 py-4">
          <span className="text-sm font-semibold tracking-tight">
            ERP Simple
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10 md:py-14">
        <h1 className="text-3xl font-semibold tracking-tight">工作台</h1>
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>
              <h2>当前账号</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-all text-muted-foreground">
              {session.user.email}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function HomePending() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <p className="text-sm text-muted-foreground" role="status">
        正在检查登录状态…
      </p>
    </main>
  );
}

function HomeError() {
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
