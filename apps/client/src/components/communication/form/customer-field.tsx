import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Communication } from "@/request/communication";
import { listCustomers } from "@/request/customers";

export type CustomerChoice = NonNullable<Communication["customer"]>;

type Lookup = {
  keyword: string;
  page: number;
  total: number;
  customers: CustomerChoice[];
};

const pageSize = 20;
const customerLabel = ({ companyName, customerNo }: CustomerChoice) =>
  `${companyName}（${customerNo}）`;

export function CommunicationCustomerField({
  value,
  locked,
  disabled,
  readOnlyFallback = "客户信息受限",
  onChange,
}: {
  value: CustomerChoice | null;
  locked: boolean;
  disabled: boolean;
  readOnlyFallback?: string;
  onChange: (customer: CustomerChoice | null) => void;
}) {
  if (locked) {
    return (
      <Field className="min-w-0">
        <FieldLabel htmlFor="communication-form-customer">客户</FieldLabel>
        <Input
          id="communication-form-customer"
          className="h-10 bg-muted/25 text-muted-foreground shadow-xs"
          value={value ? customerLabel(value) : readOnlyFallback}
          readOnly
        />
      </Field>
    );
  }

  return (
    <CustomerPicker value={value} disabled={disabled} onChange={onChange} />
  );
}

/** 按当前账号的客户权限搜索，选择结果后才修改表单绑定的客户。 */
function CustomerPicker({
  value,
  disabled,
  onChange,
}: {
  value: CustomerChoice | null;
  disabled: boolean;
  onChange: (customer: CustomerChoice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [lookup, setLookup] = useState<Lookup>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const composing = useRef(false);
  const keyword = search.trim();
  const result = lookup?.keyword === keyword ? lookup : undefined;
  const loading = !error && result?.page !== page;

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const { signal } = controller;
    setError("");
    const timer = window.setTimeout(
      () => {
        listCustomers({ search: keyword || undefined, page, pageSize }, signal)
          .then(({ customers, total }) => {
            if (signal.aborted) return;
            const options = customers.map(
              ({ id, companyName, customerNo }) => ({
                id,
                companyName,
                customerNo,
              })
            );
            setLookup((previous) => ({
              keyword,
              page,
              total,
              customers:
                page > 1 && previous?.keyword === keyword
                  ? [
                      ...new Map(
                        [...previous.customers, ...options].map((customer) => [
                          customer.id,
                          customer,
                        ])
                      ).values(),
                    ]
                  : options,
            }));
          })
          .catch((failure: unknown) => {
            if (signal.aborted) return;
            setError(
              failure instanceof Error ? failure.message : "客户加载失败。"
            );
          });
      },
      page === 1 && keyword ? 200 : 0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, open, page, retry]);

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor="communication-form-customer">客户</FieldLabel>
      <Combobox
        items={result?.customers ?? []}
        filter={null}
        open={open}
        disabled={disabled}
        inputValue={open ? search : value ? customerLabel(value) : ""}
        value={value}
        itemToStringLabel={customerLabel}
        isItemEqualToValue={(item, selected) => item.id === selected.id}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearch("");
            setPage(1);
          }
        }}
        onInputValueChange={(next, details) => {
          if (details.reason !== "input-change") return;
          setSearch(next);
          if (next.trim() !== keyword) {
            setLookup(undefined);
            setPage(1);
            setError("");
          }
        }}
        onValueChange={onChange}
      >
        <ComboboxInput
          id="communication-form-customer"
          className="h-10 w-full shadow-xs"
          placeholder="搜索并选择客户"
          maxLength={256}
          aria-required="true"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !open) return;
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              event.preventBaseUIHandler();
            } else if (
              !event.currentTarget.getAttribute("aria-activedescendant")
            ) {
              event.preventDefault();
            }
          }}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {error || (loading ? "正在加载客户…" : "没有匹配的客户")}
          </ComboboxEmpty>
          <ComboboxList>
            {(customer: CustomerChoice) => (
              <ComboboxItem key={customer.id} value={customer}>
                <span className="truncate">{customer.companyName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {customer.customerNo}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {error || (result && result.page * pageSize < result.total) ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={() => {
                  if (error) {
                    setError("");
                    setRetry((attempt) => attempt + 1);
                  } else if (result) {
                    setPage(result.page + 1);
                  }
                }}
              >
                {error ? "重试加载客户" : "加载更多客户"}
              </Button>
            </div>
          ) : null}
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
