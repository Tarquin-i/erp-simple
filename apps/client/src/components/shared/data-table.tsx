import { cn } from "cn";
import type {
  ComponentProps,
  HTMLAttributes,
  Key,
  ReactNode,
  TdHTMLAttributes,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ListPagination } from "./list-pagination";

export type DataTableColumn<TRow> = {
  id: string;
  header: string;
  widthClassName?: string;
  cellClassName?: string;
  skeletonClassName?: string;
  getCellProps?: (
    row: TRow
  ) => Omit<TdHTMLAttributes<HTMLTableCellElement>, "children">;
  renderCell: (row: TRow) => ReactNode;
};

type DataTableProps<TRow> = {
  label: string;
  minWidthClassName: string;
  columns: readonly DataTableColumn<TRow>[];
  /** Undefined while loading. An empty array displays the empty state. */
  rows?: readonly TRow[];
  getRowId: (row: TRow) => Key;
  getRowProps?: (row: TRow) => HTMLAttributes<HTMLTableRowElement>;
  loading: { label: string; rowCount: number };
  emptyState: ReactNode;
  error?: { title: string; description: string; onRetry: () => void };
  pagination?: Omit<ComponentProps<typeof ListPagination>, "className">;
};

export function DataTable<TRow>({
  label,
  minWidthClassName,
  columns,
  rows,
  getRowId,
  getRowProps,
  loading,
  emptyState,
  error,
  pagination,
}: DataTableProps<TRow>) {
  if (error) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{error.title}</EmptyTitle>
          <EmptyDescription>{error.description}</EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="outline" onClick={error.onRetry}>
          重试
        </Button>
      </Empty>
    );
  }

  if (rows?.length === 0) {
    return emptyState;
  }

  const table = (
    <Table className={cn("table-fixed border-b", minWidthClassName)}>
      <TableCaption className="sr-only">{label}</TableCaption>
      <colgroup>
        {columns.map((column) => (
          <col className={column.widthClassName} key={column.id} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className="text-muted-foreground" key={column.id}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows
          ? rows.map((row) => (
              <TableRow key={getRowId(row)} {...getRowProps?.(row)}>
                {columns.map((column) => {
                  const cellProps = column.getCellProps?.(row);
                  return (
                    <TableCell
                      key={column.id}
                      {...cellProps}
                      className={cn(column.cellClassName, cellProps?.className)}
                    >
                      {column.renderCell(row)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          : Array.from({ length: loading.rowCount }, (_, rowId) => rowId).map(
              (rowId) => (
                <TableRow aria-hidden="true" key={rowId}>
                  {columns.map((column) => (
                    <TableCell className="h-11" key={column.id}>
                      <Skeleton
                        className={
                          column.skeletonClassName ?? "h-4 w-24 max-w-full"
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              )
            )}
      </TableBody>
    </Table>
  );

  return (
    <>
      {rows ? (
        table
      ) : (
        <div role="status">
          <span className="sr-only">{loading.label}</span>
          {table}
        </div>
      )}
      {pagination && <ListPagination className="mt-5" {...pagination} />}
    </>
  );
}
