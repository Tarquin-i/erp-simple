import {
  createFileRoute,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { AddressCardActions } from "@/components/addresses/address-card";
import { AddressCollection } from "@/components/addresses/address-collection";
import {
  AddressPageError,
  AddressPagePending,
} from "@/components/addresses/load-state";
import {
  customerAddressTabLink,
  readAddressDetailSearch,
} from "@/components/addresses/navigation";
import { Button } from "@/components/ui/button";
import {
  type AddressDetail,
  getAddress,
  listCustomerAddresses,
} from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/$addressId/")({
  validateSearch: readAddressDetailSearch,
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params, deps, abortController }) => {
      const signal = abortController.signal;
      const { address } = await getAddress(params.addressId, signal);
      let collection = await listCustomerAddresses(
        address.customerId,
        deps,
        signal
      );
      const last = Math.max(
        1,
        Math.ceil(collection.total / collection.pageSize)
      );
      if (collection.page > last) {
        collection = await listCustomerAddresses(
          address.customerId,
          { page: last },
          signal
        );
      }
      return { address, collection };
    },
  },
  pendingComponent: AddressPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: ({ error }) => <AddressPageError error={error} detail />,
  component: AddressDetailRoute,
});

function AddressDetailRoute() {
  const data = Route.useLoaderData();
  return <AddressWorkspace key={data.address.id} {...data} />;
}

type AddressWorkspaceProps = {
  address: AddressDetail;
  collection: Awaited<ReturnType<typeof listCustomerAddresses>>;
};

/** 在地址模块内管理一条地址和同一客户的全部有效地址。 */
function AddressWorkspace({ address, collection }: AddressWorkspaceProps) {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { pathname, state } = useLocation();
  const { customerId } = Route.useSearch();
  const { page, pageSize, total } = collection;
  const returnCustomer = customerId === address.customerId;
  const returnLink = returnCustomer
    ? customerAddressTabLink(customerId, page, state)
    : undefined;
  const navigationState = returnCustomer
    ? { customerListQuery: state.customerListQuery }
    : { addressListQuery: state.addressListQuery };
  const addressSearch = {
    customerId: returnCustomer ? customerId : undefined,
    page: page > 1 ? page : undefined,
  };
  const currentAddressListed = collection.addresses.some(
    (item) => item.id === address.id
  );

  /** 当前地址归档后返回来源，其他卡片变更后刷新当前详情。 */
  async function refreshAfterChange(changed: AddressDetail) {
    if (router.state.location.pathname !== pathname) return;
    if (changed.id !== address.id || changed.status !== "archived") {
      await router.invalidate();
      return;
    }
    if (returnLink) {
      await navigate({ ...returnLink, replace: true });
    } else {
      await navigate({
        to: "/addresses",
        search: state.addressListQuery ?? {},
        replace: true,
      });
    }
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <section className="space-y-3" aria-labelledby="customer-addresses">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 id="customer-addresses" className="text-base font-semibold">
            客户地址
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {returnLink && (
              <Button asChild variant="outline">
                <Link {...returnLink}>返回客户地址</Link>
              </Button>
            )}
            {!currentAddressListed && (
              <AddressCardActions
                address={address}
                detail={address}
                onChanged={refreshAfterChange}
              />
            )}
            <Button asChild variant="outline">
              <Link
                to="/addresses/new"
                search={{ ...addressSearch, sourceAddressId: address.id }}
                state={navigationState}
                preload={false}
              >
                <Plus aria-hidden="true" />
                新建地址
              </Link>
            </Button>
          </div>
        </header>
        <AddressCollection
          addresses={collection.addresses}
          currentAddress={address}
          detailSearch={addressSearch}
          detailState={navigationState}
          onChanged={refreshAfterChange}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: (next) =>
              void navigate({
                search: { ...addressSearch, page: next > 1 ? next : undefined },
                state: navigationState,
                resetScroll: false,
              }),
          }}
        />
      </section>
    </main>
  );
}
