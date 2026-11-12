import {
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  ContactRound,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  MessagesSquare,
  Package,
  ReceiptText,
} from "lucide-react";

import type { FileRouteTypes } from "@/routeTree.gen";
import type { Viewer } from "@/request/organization";

type RouteItem = {
  label: string;
  path: FileRouteTypes["to"];
  icon: LucideIcon;
  exact?: boolean;
  role?: Viewer["role"];
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
      {
        label: "部门管理",
        path: "/department-management",
        icon: Building2,
        role: "company-admin",
      },
      {
        label: "入部审批",
        path: "/department-approvals",
        icon: ClipboardCheck,
        role: "supervisor",
      },
    ],
  },
  sales: {
    label: "业务",
    items: [
      { label: "客户", path: "/customers", icon: ContactRound },
      { label: "沟通", path: "/communication", icon: MessagesSquare },
      { label: "地址", path: "/addresses", icon: MapPin },
      { label: "产品", path: "/products", icon: Package },
      { label: "Payout", path: "/payouts", icon: CircleDollarSign },
    ],
  },
  orders: {
    label: "订单",
    items: [{ label: "订单", path: "/orders", icon: ReceiptText }],
  },
};
