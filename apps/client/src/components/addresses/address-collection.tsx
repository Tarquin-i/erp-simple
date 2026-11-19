import { CustomerPagination } from "@/components/customers/pagination";
import type { AddressDetail, AddressListItem } from "@/request/addresses";

import { AddressCard } from "./address-card";
import { addressCollectionClass } from "./load-state";

type AddressCollectionProps = {
  addresses: readonly AddressListItem[];
  currentAddress?: AddressDetail;
  onChanged: (address: AddressDetail) => void | Promise<void>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
};

/**
 * 展示同一客户的地址列表，并标识当前地址及默认地址。
 * @param props 地址摘要、当前详情、更新回调及分页参数。
 * @returns 供客户详情和地址详情使用的可展开地址卡片及分页控件。
 */
export function AddressCollection({
  addresses,
  currentAddress,
  onChanged,
  pagination,
}: AddressCollectionProps) {
  return (
    <div className={addressCollectionClass}>
      {addresses.length ? (
        <ul aria-label="客户地址列表" className="space-y-3">
          {addresses.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              currentAddress={
                currentAddress?.id === address.id ? currentAddress : undefined
              }
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed py-9 text-center text-sm text-muted-foreground">
          暂无地址
        </p>
      )}
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
    </div>
  );
}
