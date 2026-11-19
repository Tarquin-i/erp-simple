import { type ComponentProps, useEffect, useRef, useState } from "react";

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
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { Communication } from "@/request/communication";
import { listCustomers } from "@/request/customers";

export type CustomerChoice = NonNullable<Communication["customer"]>;

type Lookup = {
  keyword: string;
  page: number;
  total: number;
  customers: CustomerChoice[];
};
type PortalContainer = ComponentProps<typeof ComboboxContent>["container"];

const pageSize = 20;
const customerLabel = ({ companyName, customerNo }: CustomerChoice) =>
  `${companyName}（${customerNo}）`;
const renderCustomerOption = (customer: CustomerChoice) => (
  <>
    <span className="truncate">{customer.companyName}</span>
    <span className="shrink-0 text-xs text-muted-foreground">
      {customer.customerNo}
    </span>
  </>
);

export function CommunicationCustomerField({
  value,
  locked,
  disabled,
  onChange,
  portalContainer,
  searchInDropdown = false,
}: {
  value: CustomerChoice | null;
  locked: boolean;
  disabled: boolean;
  onChange: (customer: CustomerChoice | null) => void;
  portalContainer?: PortalContainer;
  searchInDropdown?: boolean;
}) {
  if (locked) {
    return (
      <Field className="min-w-0">
        <FieldLabel htmlFor="communication-form-customer">客户</FieldLabel>
        <Input
          id="communication-form-customer"
          className="h-10 bg-muted/25 text-muted-foreground shadow-xs"
          value={value ? customerLabel(value) : "客户信息受限"}
          readOnly
        />
      </Field>
    );
  }

  return (
    <CustomerPicker
      value={value}
      disabled={disabled}
      onChange={onChange}
      portalContainer={portalContainer}
      searchInDropdown={searchInDropdown}
    />
  );
}

/** 按当前账号的客户权限搜索，选择结果后才修改表单绑定的客户。 */
function CustomerPicker({
  value,
  disabled,
  onChange,
  portalContainer,
  searchInDropdown,
}: {
  value: CustomerChoice | null;
  disabled: boolean;
  onChange: (customer: CustomerChoice | null) => void;
  portalContainer?: PortalContainer;
  searchInDropdown: boolean;
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

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setSearch("");
      setPage(1);
    }
  }

  function changeSearch(next: string) {
    setSearch(next);
    if (next.trim() !== keyword) {
      setLookup(undefined);
      setPage(1);
      setError("");
    }
  }

  const emptyMessage = error || (loading ? "正在加载客户…" : "没有匹配的客户");
  const footer =
    error || (result && result.page * pageSize < result.total) ? (
      <div className="shrink-0 border-t p-1">
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
    ) : null;

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor="communication-form-customer">客户</FieldLabel>
      {searchInDropdown ? (
        <SearchableSelect
          id="communication-form-customer"
          items={(result?.customers ?? []).map((customer) => ({
            ...customer,
            name: customerLabel(customer),
          }))}
          value={value ? { ...value, name: customerLabel(value) } : null}
          placeholder="搜索并选择客户"
          searchPlaceholder="搜索客户名称或编号"
          emptyMessage={emptyMessage}
          disabled={disabled}
          container={portalContainer}
          remoteSearch={{
            open,
            query: search,
            onOpenChange: changeOpen,
            onQueryChange: changeSearch,
          }}
          getOptionKey={(customer) => customer.id}
          renderOption={renderCustomerOption}
          footer={footer}
          onValueChange={({ id, companyName, customerNo }) =>
            onChange({ id, companyName, customerNo })
          }
        />
      ) : (
        <Combobox
          items={result?.customers ?? []}
          filter={null}
          open={open}
          disabled={disabled}
          inputValue={open ? search : value ? customerLabel(value) : ""}
          value={value}
          itemToStringLabel={customerLabel}
          isItemEqualToValue={(item, selected) => item.id === selected.id}
          onOpenChange={changeOpen}
          onInputValueChange={(next, details) => {
            if (details.reason === "input-change") changeSearch(next);
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
          <ComboboxContent container={portalContainer}>
            <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
            <ComboboxList>
              {(customer: CustomerChoice) => (
                <ComboboxItem key={customer.id} value={customer}>
                  {renderCustomerOption(customer)}
                </ComboboxItem>
              )}
            </ComboboxList>
            {footer}
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  );
}
