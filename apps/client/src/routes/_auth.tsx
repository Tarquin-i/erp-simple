import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getAuthSession } from "@/request/auth";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    // 会话查询失败时仍允许打开登录和注册页，已有会话则交给工作台路由继续分流。
    const result = await getAuthSession().catch(() => null);

    if (result?.data) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: Outlet,
});
