import { Link, createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data: session, error, isPending } = authClient.useSession();

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">ERP Simple</h1>
      <p className="break-all text-muted-foreground" role="status">
        {session
          ? `已登录：${session.user.email}`
          : isPending
            ? "正在读取登录状态…"
            : error
              ? "暂时无法读取登录状态。"
              : "当前未登录。"}
      </p>
      {!session && !isPending && (
        <nav className="flex gap-3" aria-label="账号">
          <Button asChild>
            <Link to="/login">登录</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/register">注册</Link>
          </Button>
        </nav>
      )}
    </main>
  );
}
