import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getAuthSession } from "@/request/auth";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    const result = await getAuthSession().catch(() => null);

    if (result?.data) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: Outlet,
});
