import { Link, type HistoryState } from "@tanstack/react-router";

import { CustomerPagination } from "@/components/customers/pagination";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AddressListItem } from "@/request/addresses";

import type { readAddressDetailSearch } from "./navigation";

type AddressCollectionProps = {
  addresses: readonly AddressListItem[];
  currentAddressId?: string;
  detailSearch: ReturnType<typeof readAddressDetailSearch>;
  detailState: Pick<HistoryState, "addressListQuery" | "customerListQuery">;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
};

export function AddressCollectionPending() {
  return (
    <div className="space-y-2" aria-label="正在加载客户地址" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/**
 * 展示同一客户的地址列表，并标识当前地址及默认地址。
 * @param props 地址数据、当前地址 ID、详情导航状态和分页参数。
 * @returns 供客户详情和地址详情使用的表格及分页控件。
 */
export function AddressCollection({
  addresses,
  currentAddressId,
  detailSearch,
  detailState,
  pagination,
}: AddressCollectionProps) {
  return (
    <>
      <Table aria-label="客户地址列表" className="min-w-[530px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/2">收货地址</TableHead>
            <TableHead className="w-1/4">收货人</TableHead>
            <TableHead className="w-1/4">联系电话</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {addresses.map((address) => {
            const isCurrent = address.id === currentAddressId;
            return (
              <TableRow
                key={address.id}
                data-state={isCurrent ? "selected" : undefined}
              >
                <TableCell className="py-3">
                  <div className="flex items-center gap-2">
                    {isCurrent ? (
                      <span
                        aria-current="page"
                        title={address.formattedAddress}
                        className="truncate"
                      >
                        {address.formattedAddress}
                      </span>
                    ) : (
                      <Link
                        to="/addresses/$addressId"
                        params={{ addressId: address.id }}
                        search={detailSearch}
                        state={detailState}
                        preload={false}
                        title={address.formattedAddress}
                        className="truncate rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {address.formattedAddress}
                      </Link>
                    )}
                    {address.isDefault && (
                      <Badge variant="secondary">默认</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="truncate" title={address.recipientName}>
                  {address.recipientName}
                </TableCell>
                <TableCell className="tabular-nums">{address.phone}</TableCell>
              </TableRow>
            );
          })}
          {addresses.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={3}
                className="h-24 text-center text-muted-foreground"
              >
                暂无地址
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <CustomerPagination
        label="客户地址分页"
        page={pagination.page}
        pageCount={Math.max(
          1,
          Math.ceil(pagination.total / pagination.pageSize)
        )}
        total={pagination.total}
        onPageChange={pagination.onPageChange}
      />
    </>
  );
}
