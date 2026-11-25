import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

import { hasVisibleTagColor, TagColorDot } from "./tag-color-dot";

export function TagBadge({
  color,
  name,
  className,
  title,
}: {
  color?: string | null;
  name: string;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      variant={hasVisibleTagColor(color) ? "outline" : "default"}
      className={cn("min-w-0 max-w-full", className)}
      title={title}
    >
      <TagColorDot color={color} />
      <span className="truncate">{name}</span>
    </Badge>
  );
}
