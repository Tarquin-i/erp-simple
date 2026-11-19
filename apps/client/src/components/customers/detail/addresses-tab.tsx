import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AddressCollection } from "@/components/addresses/address-collection";
import { AddressCollectionPending } from "@/components/addresses/load-state";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  listCustomerAddresses,
  type AddressCustomer,
} from "@/request/addresses";

import { readListQueryFromState } from "../list-query";

type AddressPage = Awaited<ReturnType<typeof listCustomerAddresses>>;
type LoadResult = { page: number; attempt: number } & (
  | { collection: AddressPage }
  | { error: string }
);

/** 在客户详情按页加载该客户的有效地址，复用地址模块的新建和详情。 */
export default function CustomerAddressesTab({
  customer,
  createActionSlot,
}: {
  customer: AddressCustomer;
  createActionSlot: HTMLDivElement | null;
}) {
  const { addressPage = 1 } = useSearch({
    from: "/_protected/customers/$customerId/",
  });
  const navigate = useNavigate({ from: "/customers/$customerId/" });
  const { state } = useLocation();
  const [load, setLoad] = useState<LoadResult>();
  const [attempt, setAttempt] = useState(0);
  // 同一页写入后的刷新保留已展开的卡片，等最新列表返回再更新。
  const current =
    load?.page === addressPage &&
    (load.attempt === attempt || "collection" in load)
      ? load
      : undefined;
  const addressSearch = {
    customerId: customer.id,
    page: addressPage > 1 ? addressPage : undefined,
  };
  const navigationState = { customerListQuery: readListQueryFromState(state) };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listCustomerAddresses(customer.id, { page: addressPage }, signal).then(
      (collection) => {
        if (signal.aborted) return;
        const last = Math.max(
          1,
          Math.ceil(collection.total / collection.pageSize)
        );
        // 归档最后一页的最后一条地址时，返回仍有地址的上一页。
        if (collection.page > last) {
          void navigate({
            search: {
              tab: "addresses",
              addressPage: last > 1 ? last : undefined,
            },
            state: (previous) => previous,
            resetScroll: false,
            replace: true,
          });
          return;
        }
        setLoad({ page: addressPage, attempt, collection });
      },
      (failure: unknown) => {
        if (!signal.aborted) {
          setLoad({
            page: addressPage,
            attempt,
            error:
              failure instanceof Error ? failure.message : "暂时无法加载地址。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [addressPage, attempt, customer.id, navigate]);

  return (
    <>
      {createActionSlot &&
        createPortal(
          <Button asChild>
            <Link
              to="/addresses/new"
              search={addressSearch}
              state={navigationState}
              preload={false}
            >
              <Plus aria-hidden="true" />
              新建地址
            </Link>
          </Button>,
          createActionSlot
        )}
      {!current ? (
        <AddressCollectionPending />
      ) : "error" in current ? (
        <div className="space-y-3">
          <FieldError>{current.error}</FieldError>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((previous) => previous + 1)}
          >
            重试
          </Button>
        </div>
      ) : (
        <AddressCollection
          addresses={current.collection.addresses}
          detailSearch={addressSearch}
          detailState={navigationState}
          onChanged={() => setAttempt((previous) => previous + 1)}
          pagination={{
            page: current.collection.page,
            pageSize: current.collection.pageSize,
            total: current.collection.total,
            onPageChange: (page) =>
              void navigate({
                search: {
                  tab: "addresses",
                  addressPage: page > 1 ? page : undefined,
                },
                state: (previous) => previous,
                resetScroll: false,
              }),
          }}
        />
      )}
    </>
  );
}
