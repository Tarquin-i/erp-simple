import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CustomerPagination({
  label,
  page,
  pageCount,
  total,
  className,
  onPageChange,
}: {
  label: string;
  page: number;
  pageCount: number;
  total?: number;
  className?: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav
      aria-label={label}
      className={`flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground${className ? ` ${className}` : ""}`}
    >
      <span
        className="tabular-nums"
        title={total === undefined ? undefined : `共 ${total} 条`}
      >
        第 {page} 页，共 {pageCount} 页
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 px-4"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft data-icon="inline-start" />
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 px-4"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  );
}
