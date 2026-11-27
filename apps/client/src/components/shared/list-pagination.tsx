import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { MouseEvent } from "react";

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

type PageButton = "previous" | "current" | "next";

export function ListPagination({
  label,
  result,
  className,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = LIST_PAGE_SIZES,
}: {
  label: string;
  result?: { page: number; pageSize: number; total: number };
  className?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
}) {
  const previousButton = useRef<HTMLButtonElement>(null);
  const currentButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{
    page: number;
    pageSize: number;
    button: PageButton;
  }>(undefined);
  const pageCount = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;

  // 等新页渲染后恢复键盘焦点。如果用户已在操作其他控件，保留其焦点。
  useLayoutEffect(() => {
    if (!result) return;
    const focus = pendingFocus.current;
    pendingFocus.current = undefined;
    if (
      !focus ||
      result.page !== Math.min(focus.page, pageCount) ||
      result.pageSize !== focus.pageSize ||
      document.activeElement !== document.body
    ) {
      return;
    }

    const button = {
      previous: previousButton,
      current: currentButton,
      next: nextButton,
    }[focus.button].current;
    (button?.disabled ? currentButton.current : button)?.focus();
  }, [result, pageCount]);

  if (!result) return null;

  const { page, pageSize, total } = result;
  const currentPage = Math.min(pageCount, Math.max(1, page));
  const firstRecord = (currentPage - 1) * pageSize + 1;
  const lastRecord = Math.min(total, currentPage * pageSize);
  const firstPage = Math.max(1, Math.min(currentPage - 1, pageCount - 2));
  const nearbyPages = Array.from(
    { length: Math.min(3, pageCount) },
    (_, index) => firstPage + index
  );
  const pageSizes = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((left, right) => left - right);

  function changePage(
    event: MouseEvent<HTMLButtonElement>,
    page: number,
    button: PageButton
  ) {
    pendingFocus.current =
      event.detail === 0 && document.activeElement === event.currentTarget
        ? { page, pageSize, button }
        : undefined;
    onPageChange(page);
  }

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
                  ref={previousButton}
                  aria-label="上一页"
                  disabled={currentPage === 1}
                  onClick={(event) =>
                    changePage(event, currentPage - 1, "previous")
                  }
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
                    ref={targetPage === currentPage ? currentButton : undefined}
                    aria-label={`第 ${targetPage} 页`}
                    className="tabular-nums"
                    onClick={
                      targetPage === currentPage
                        ? undefined
                        : (event) => changePage(event, targetPage, "current")
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
                  ref={nextButton}
                  aria-label="下一页"
                  disabled={currentPage === pageCount}
                  onClick={(event) =>
                    changePage(event, currentPage + 1, "next")
                  }
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
