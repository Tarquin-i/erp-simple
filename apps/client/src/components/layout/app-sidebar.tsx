import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { ROUTES } from "@/constants/route";
import { signOut } from "@/request/auth";

export function AppSidebar({
  account,
}: {
  account: { name: string; email: string; image?: string | null };
}) {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
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
      <SidebarHeader className="h-12 shrink-0 justify-center px-3.5">
        <span className="text-base font-semibold tracking-tight">
          ERP Simple
        </span>
      </SidebarHeader>

      <SidebarContent className="pt-3 pr-4 pl-0.5">
        <nav className="flex flex-col gap-2.5" aria-label="主导航">
          {Object.entries(ROUTES).map(([key, group]) => (
            <SidebarGroup key={key} className="p-0">
              <SidebarGroupLabel className="h-6">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent className="mt-0.5">
                <SidebarMenu className="gap-0.5">
                  {group.items.map(({ label, path, icon: Icon, exact }) => (
                    <SidebarMenuItem key={path}>
                      <SidebarMenuButton
                        asChild
                        isActive={Boolean(
                          matchRoute({
                            to: path,
                            fuzzy: !exact,
                            includeSearch: false,
                          })
                        )}
                      >
                        <Link
                          to={path}
                          activeOptions={{ exact, includeSearch: false }}
                        >
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="px-1.5 pb-4">
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
                  <Avatar
                    aria-hidden="true"
                    className="rounded-lg after:rounded-lg"
                  >
                    {account.image && (
                      <AvatarImage
                        src={account.image}
                        alt=""
                        className="rounded-lg"
                      />
                    )}
                    <AvatarFallback className="rounded-lg">
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {isSigningOut ? "正在退出…" : displayName}
                  </span>
                  <ChevronsUpDown
                    aria-hidden="true"
                    className="opacity-0 group-hover/menu-button:opacity-100 group-focus-visible/menu-button:opacity-100"
                  />
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
