import { cn } from "cn";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

import { hasVisibleTagColor, TagColorDot } from "./tag-color-dot";

export function TagBadge({
  color,
  icon,
  name,
  className,
  title,
}: {
  color?: string | null;
  icon?: ReactNode;
  name: string;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      variant={icon || hasVisibleTagColor(color) ? "outline" : "default"}
      className={cn("min-w-0 max-w-full", className)}
      title={title}
    >
      {icon ?? <TagColorDot color={color} />}
      <span className="truncate">{name}</span>
    </Badge>
  );
}
