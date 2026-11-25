import { cn } from "cn";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function ListEmptyState({
  icon,
  title,
  description,
  variant = "default",
  mediaClassName,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  variant?: "default" | "prominent";
  mediaClassName?: string;
}) {
  const prominent = variant === "prominent";
  return (
    <Empty className="min-h-52 border">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            prominent &&
              "size-12 rounded-xl border bg-background shadow-xs [&_svg]:size-5",
            mediaClassName
          )}
        >
          {icon}
        </EmptyMedia>
        <EmptyTitle className={prominent ? "text-xl font-semibold" : undefined}>
          {title}
        </EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}
