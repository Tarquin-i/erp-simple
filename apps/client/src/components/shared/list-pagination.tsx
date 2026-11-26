import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIST_PAGE_SIZES } from "@/lib/list-page-size";

export function ListPagination({
  label,
  page,
  pageSize,
  total,
  className,
  onPageChange,
  onPageSizeChange,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  className?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(pageCount, Math.max(1, page));
  const firstRecord = (currentPage - 1) * pageSize + 1;
  const lastRecord = Math.min(total, currentPage * pageSize);
  const firstPage = Math.max(1, Math.min(currentPage - 1, pageCount - 2));
  const nearbyPages = Array.from(
    { length: Math.min(3, pageCount) },
    (_, index) => firstPage + index
  );
  const pageSizes = LIST_PAGE_SIZES.includes(pageSize)
    ? LIST_PAGE_SIZES
    : [...LIST_PAGE_SIZES, pageSize].sort((left, right) => left - right);

  return (
    <div className={cn("@container text-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @max-[575px]:grid @max-[575px]:grid-cols-[minmax(0,1fr)_auto]">
        <span aria-live="polite" className="text-muted-foreground tabular-nums">
          {total > 0 ? `${firstRecord}–${lastRecord} 条 ` : ""}共 {total} 条
        </span>
        {onPageSizeChange && (
          <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
            <span>每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                aria-label="每页显示条数"
                className="min-w-18.5 tabular-nums"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="end"
                className="min-w-18.5"
              >
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Pagination
          aria-label={label}
          className={cn(
            "mx-0 w-auto @max-[575px]:justify-self-end",
            onPageSizeChange && "@max-[575px]:col-span-2"
          )}
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationLink asChild>
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={currentPage === 1}
                  onClick={() => onPageChange(currentPage - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
              </PaginationLink>
            </PaginationItem>
            {nearbyPages.map((targetPage) => (
              <PaginationItem key={targetPage}>
                <PaginationLink asChild isActive={targetPage === currentPage}>
                  <button
                    type="button"
                    aria-label={`第 ${targetPage} 页`}
                    className="tabular-nums"
                    onClick={
                      targetPage === currentPage
                        ? undefined
                        : () => onPageChange(targetPage)
                    }
                  >
                    {targetPage}
                  </button>
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationLink asChild>
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={currentPage === pageCount}
                  onClick={() => onPageChange(currentPage + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
