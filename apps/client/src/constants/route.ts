import { LayoutDashboard, type LucideIcon } from "lucide-react";

import type { FileRouteTypes } from "@/routeTree.gen";

type RouteItem = {
  label: string;
  path: FileRouteTypes["to"];
  icon: LucideIcon;
  exact?: boolean;
};

type RouteGroup = {
  label: string;
  items: RouteItem[];
};

// 按显示顺序配置侧栏分组和菜单。业务页面建好路由后，在这里添加入口。
export const ROUTES: Record<string, RouteGroup> = {
  workspace: {
    label: "导航",
    items: [
      {
        label: "工作台",
        path: "/",
        icon: LayoutDashboard,
        exact: true,
      },
    ],
  },
};
