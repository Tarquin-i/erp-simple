import {
  createFileRoute,
  Link,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";

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
import { toastManager } from "@/components/ui/toast";
import {
  AddressApiError,
  type AddressDetail,
  getAddress,
} from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/$addressId/")({
  validateSearch: readAddressDetailSearch,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController, location, preload }) => {
      const signal = abortController.signal;
      return getAddress(params.addressId, signal).catch((error: unknown) => {
        if (
          signal.aborted ||
          !(error instanceof AddressApiError) ||
          error.status !== 404
        ) {
          throw error;
        }
        if (!preload) {
          toastManager.add({ title: "该地址已不可查看", type: "error" });
        }
        throw redirect({
          to: "/addresses",
          search: location.state.addressListQuery ?? {},
          replace: true,
        });
      });
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

/** 在地址模块内管理一条地址和同一客户的全部有效地址。 */
function AddressWorkspace({ address }: { address: AddressDetail }) {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { pathname, state } = useLocation();
  const { customerId } = Route.useSearch();
  const returnCustomer = customerId === address.customerId;
  const returnLink = returnCustomer
    ? customerAddressTabLink(customerId, state)
    : undefined;
  const navigationState = returnCustomer
    ? { customerListQuery: state.customerListQuery }
    : { addressListQuery: state.addressListQuery };
  /** 变更后刷新当前地址快照，归档当前地址则结束加载并返回来源。 */
  async function syncAddressAfterChange(changed: AddressDetail) {
    if (router.state.location.pathname !== pathname) return false;
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
    return false;
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <section aria-labelledby="customer-addresses">
        <AddressCollection
          customerId={address.customerId}
          header={
            <header className="flex flex-wrap items-start justify-between gap-2 pb-1.5">
              <div className="min-w-0 space-y-1">
                <h1
                  id="customer-addresses"
                  className="text-xl font-semibold tracking-tight wrap-anywhere"
                >
                  {address.customer.companyName}
                </h1>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {address.customer.customerNo}
                </p>
              </div>
              <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                {returnLink && (
                  <Button asChild variant="outline">
                    <Link {...returnLink}>返回客户地址</Link>
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link
                    to="/addresses/new"
                    search={{
                      customerId: returnCustomer ? customerId : undefined,
                      sourceAddressId: address.id,
                    }}
                    state={navigationState}
                    preload={false}
                  >
                    <Plus aria-hidden="true" />
                    新建地址
                  </Link>
                </Button>
              </div>
            </header>
          }
          currentAddress={address}
          onChanged={syncAddressAfterChange}
        />
      </section>
    </main>
  );
}
