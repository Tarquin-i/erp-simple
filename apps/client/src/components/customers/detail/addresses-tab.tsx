import {
  useLocation,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  AddressCollection,
  AddressCollectionPending,
} from "@/components/addresses/address-collection";
import { AddressFormDialog } from "@/components/addresses/address-form";
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
  const router = useRouter();
  const { state, pathname } = useLocation();
  const [load, setLoad] = useState<LoadResult>();
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const current =
    load?.page === addressPage && load.attempt === attempt ? load : undefined;
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
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            新建地址
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
      {creating && (
        <AddressFormDialog
          customer={customer}
          onClose={() => setCreating(false)}
          onSaved={async (address) => {
            const currentLocation = router.state.location;
            if (
              currentLocation.pathname === pathname &&
              currentLocation.search.tab === "addresses"
            ) {
              await navigate({
                to: "/addresses/$addressId",
                params: { addressId: address.id },
                search: addressSearch,
                state: navigationState,
              });
            }
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
