import { cn } from "cn";
import { Filter } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ListToolbar({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className
      )}
    >
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="flex max-w-full min-w-0 items-center gap-2">
        {children}
      </div>
    </header>
  );
}

export function ListSearchInput({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  return <Input type="search" className={cn("w-56", className)} {...props} />;
}

export function ListFilterButton({
  count,
  ...props
}: ComponentProps<"button"> & { count: number }) {
  const label = count ? `筛选，已应用 ${count} 项` : "筛选";
  return (
    <Button
      type="button"
      size="icon"
      variant={count ? "secondary" : "outline"}
      aria-label={label}
      title={label}
      {...props}
    >
      <Filter aria-hidden="true" />
    </Button>
  );
}
