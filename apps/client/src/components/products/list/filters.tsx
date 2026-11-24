import { useEffect, useState } from "react";

import { CommunicationCustomerField } from "@/components/shared/customer-field";
import type { CustomerChoice } from "@/components/shared/customer-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCustomer } from "@/request/customers";
import { productTypeLabels } from "@/request/products";
import type { ProductListQuery, ProductType } from "@/request/products";

type ProductFilters = Pick<
  ProductListQuery,
  "customerId" | "productTypes" | "sortDirection"
>;

const productTypes = Object.keys(productTypeLabels) as ProductType[];

export function ProductListFilters({
  filters,
  selectedCustomer,
  container,
  onApply,
}: {
  filters: ProductFilters;
  selectedCustomer?: CustomerChoice;
  container: HTMLDivElement | null;
  onApply: (filters: ProductFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [pickedCustomer, setPickedCustomer] = useState<CustomerChoice | null>(
    selectedCustomer ?? null
  );
  const [loadedCustomer, setLoadedCustomer] = useState<CustomerChoice>();
  const customer =
    pickedCustomer && pickedCustomer.id === draft.customerId
      ? pickedCustomer
      : loadedCustomer && loadedCustomer.id === draft.customerId
        ? loadedCustomer
        : null;

  // 即使当前筛选没有命中产品，也能显示已选客户并支持清空。
  useEffect(() => {
    if (!filters.customerId || selectedCustomer?.id === filters.customerId)
      return;
    const controller = new AbortController();
    void getCustomer(filters.customerId, controller.signal).then(
      ({ customer }) => {
        if (!controller.signal.aborted) setLoadedCustomer(customer);
      },
      () => {}
    );
    return () => controller.abort();
  }, [filters.customerId, selectedCustomer?.id]);

  return (
    <div role="form" aria-label="筛选产品">
      <PopoverHeader className="border-b px-4 py-3">
        <PopoverTitle>筛选产品</PopoverTitle>
      </PopoverHeader>
      <div className="space-y-4 p-4">
        <CommunicationCustomerField
          value={customer}
          locked={false}
          disabled={false}
          portalContainer={container}
          onChange={(next) => {
            setPickedCustomer(next);
            setDraft((current) => ({ ...current, customerId: next?.id }));
          }}
        />
        {draft.customerId && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() =>
              setDraft((current) => ({ ...current, customerId: undefined }))
            }
          >
            清除客户筛选
          </Button>
        )}
        <FieldSet className="gap-2">
          <FieldLegend variant="label">产品类型</FieldLegend>
          <div className="grid grid-cols-2 gap-2.5">
            {productTypes.map((type) => (
              <Label key={type} className="gap-2 font-normal">
                <Checkbox
                  checked={draft.productTypes?.includes(type) ?? false}
                  onCheckedChange={(checked) => {
                    setDraft((current) => {
                      const selected = current.productTypes ?? [];
                      const next = checked
                        ? [...selected, type]
                        : selected.filter((value) => value !== type);
                      return {
                        ...current,
                        productTypes: next.length ? next : undefined,
                      };
                    });
                  }}
                />
                {productTypeLabels[type]}
              </Label>
            ))}
          </div>
        </FieldSet>
        <div className="space-y-2">
          <Label htmlFor="product-sort-direction" preventControlActivation>
            创建时间排序
          </Label>
          <Select
            value={draft.sortDirection ?? "desc"}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                sortDirection: value === "asc" ? "asc" : undefined,
              }))
            }
          >
            <SelectTrigger id="product-sort-direction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">最新优先</SelectItem>
              <SelectItem value="asc">最早优先</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <Button type="button" variant="ghost" onClick={() => onApply({})}>
          重置
        </Button>
        <Button type="button" onClick={() => onApply(draft)}>
          应用筛选
        </Button>
      </div>
    </div>
  );
}
