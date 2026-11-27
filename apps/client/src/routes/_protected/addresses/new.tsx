import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";

import { AddressCreateForm } from "@/components/addresses/address-form";
import {
  AddressFormPending,
  AddressPageError,
} from "@/components/addresses/load-state";
import {
  customerAddressTabLink,
  readAddressFormSearch,
} from "@/components/addresses/navigation";
import { getAddress } from "@/request/addresses";
import { getCustomer } from "@/request/customers";

export const Route = createFileRoute("/_protected/addresses/new")({
  validateSearch: readAddressFormSearch,
  loaderDeps: ({ search: { customerId, sourceAddressId } }) => ({
    customerId,
    sourceAddressId,
  }),
  loader: async ({
    deps: { customerId, sourceAddressId },
    abortController,
  }) => {
    const { signal } = abortController;
    if (sourceAddressId) {
      const { address } = await getAddress(sourceAddressId, signal);
      return { customer: address.customer };
    }
    if (customerId) {
      const { customer } = await getCustomer(customerId, signal);
      return { customer };
    }
    return { customer: undefined };
  },
  component: NewAddressPage,
  pendingComponent: AddressFormPending,
  errorComponent: ({ error }) => <AddressPageError error={error} detail />,
});

/** 按入口锁定已有客户，取消和保存时保留来源页面的导航条件。 */
function NewAddressPage() {
  const { customer } = Route.useLoaderData();
  const { customerId, sourceAddressId } = Route.useSearch();
  const location = useLocation();
  const { state } = location;
  const router = useRouter();
  const navigate = Route.useNavigate();
  const returnCustomerId = customer?.id === customerId ? customerId : undefined;
  const addressSearch = { customerId: returnCustomerId };
  const navigationState = returnCustomerId
    ? { customerListQuery: state.customerListQuery }
    : { addressListQuery: state.addressListQuery };

  function returnToSource() {
    if (sourceAddressId) {
      return navigate({
        to: "/addresses/$addressId",
        params: { addressId: sourceAddressId },
        search: addressSearch,
        state: navigationState,
        replace: true,
      });
    }
    if (returnCustomerId) {
      return navigate({
        ...customerAddressTabLink(returnCustomerId, state),
        replace: true,
      });
    }
    return navigate({
      to: "/addresses",
      search: state.addressListQuery ?? {},
      replace: true,
    });
  }

  return (
    <AddressCreateForm
      key={customer?.id ?? "new"}
      customer={customer}
      onCancel={() => void returnToSource()}
      onSaved={async (address) => {
        // 浏览器已离开表单时，迟到的成功响应不打断当前页面。
        const current = router.state.location;
        if (
          current.href !== location.href ||
          current.state.__TSR_key !== state.__TSR_key
        ) {
          return;
        }
        await navigate({
          to: "/addresses/$addressId",
          params: { addressId: address.id },
          search: returnCustomerId ? addressSearch : {},
          state: navigationState,
          replace: true,
        });
      }}
    />
  );
}
