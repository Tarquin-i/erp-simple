import type { ReactNode } from "react";

export function ListPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      {children}
    </div>
  );
}
