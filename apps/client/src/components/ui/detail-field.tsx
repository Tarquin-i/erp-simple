import { cn } from "cn";
import type { ReactNode } from "react";

export function DetailField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm wrap-anywhere">{children}</dd>
    </div>
  );
}
