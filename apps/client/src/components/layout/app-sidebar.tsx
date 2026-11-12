import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsUpDown, LayoutDashboard, LogOut } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { signOut } from "@/request/auth";

export function AppSidebar({
  account,
}: {
  account: { name: string; email: string };
}) {
  const navigate = useNavigate();
  const isHome = useRouterState({
    select: (state) => state.location.pathname === "/",
  });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const displayName = account.name.trim() || account.email;

  async function handleSignOut() {
    setIsSigningOut(true);
    setSignOutError("");

    try {
      const { error } = await signOut();
      if (error) throw new Error("Sign-out request failed");

      await navigate({ to: "/login", replace: true });
    } catch {
      setSignOutError("退出登录失败，请重试。");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <Sidebar>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-4">
        <span className="text-sm font-semibold tracking-tight">ERP Simple</span>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="主导航">
          <SidebarGroup>
            <SidebarGroupLabel>导航</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isHome}>
                    <Link to="/" activeOptions={{ exact: true }}>
                      <LayoutDashboard aria-hidden="true" />
                      <span>工作台</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {signOutError && (
          <p className="px-2 text-sm text-destructive" role="alert">
            {signOutError}
          </p>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label="账号菜单"
                  aria-busy={isSigningOut}
                  disabled={isSigningOut}
                >
                  <Avatar aria-hidden="true">
                    <AvatarFallback>
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {isSigningOut ? "正在退出…" : displayName}
                  </span>
                  <ChevronsUpDown aria-hidden="true" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" sideOffset={8}>
                <DropdownMenuLabel className="truncate">
                  {account.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleSignOut()}>
                  <LogOut aria-hidden="true" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
