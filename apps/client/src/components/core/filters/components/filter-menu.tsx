import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import { Search } from "lucide-react";
import { createContext, useContext } from "react";
import type { ComponentProps } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Command } from "@/components/ui/command";
import { PopoverContent } from "@/components/ui/popover";

export const FilterMenuAutoFocus = createContext(true);

export function FilterMenuContent({
  flat,
  className,
  ...props
}: ComponentProps<typeof PopoverContent> & { flat?: boolean }) {
  return (
    <PopoverContent
      collisionPadding={flat ? 12 : undefined}
      className={cn(
        "w-fit p-0 origin-(--radix-popover-content-transform-origin)",
        flat &&
          "max-h-(--radix-popover-content-available-height) w-54 max-w-[calc(100vw-1.5rem)] overflow-hidden",
        className
      )}
      {...props}
    />
  );
}

export function FilterMenuCommand({
  className,
  filter,
  ...props
}: ComponentProps<typeof Command>) {
  return (
    <Command
      className={cn("min-h-0 rounded-none! p-0", className)}
      filter={
        filter ??
        ((value, search, keywords = []) =>
          [value, ...keywords]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase())
            ? 1
            : 0)
      }
      {...props}
    />
  );
}

export function FilterMenuSearch({
  autoFocus,
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  const autoFocusAllowed = useContext(FilterMenuAutoFocus);
  return (
    <div
      data-slot="filter-menu-search"
      className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
    >
      <Search
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        autoFocus={autoFocus && autoFocusAllowed}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
          className
        )}
        {...props}
      />
    </div>
  );
}

export function FilterMenuCheckbox({ checked }: { checked: boolean }) {
  return (
    <Checkbox
      aria-hidden="true"
      checked={checked}
      className="pointer-events-none"
      tabIndex={-1}
    />
  );
}
