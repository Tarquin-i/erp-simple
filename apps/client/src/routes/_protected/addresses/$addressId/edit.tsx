import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useRef } from "react";

import { AddressEditForm } from "@/components/addresses/address-form";
import {
  AddressFormPending,
  AddressPageError,
} from "@/components/addresses/load-state";
import {
  customerAddressTabLink,
  readAddressFormSearch,
} from "@/components/addresses/navigation";
import { toastManager } from "@/components/shared/toast";
import { getAddress } from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/$addressId/edit")({
  validateSearch: readAddressFormSearch,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getAddress(params.addressId, abortController.signal),
  },
  pendingComponent: AddressFormPending,
  errorComponent: ({ error }) => <AddressPageError error={error} detail />,
  component: EditAddressPage,
});

function EditAddressPage() {
  const { address } = Route.useLoaderData();
  const { customerId, sourceAddressId } = Route.useSearch();
  const location = useLocation();
  const { state } = location;
  const router = useRouter();
  const navigate = Route.useNavigate();
  const returning = useRef(false);
  const returnCustomerId =
    address.customerId === customerId ? customerId : undefined;

  function returnToSource() {
    if (returning.current) return;
    const destination =
      returnCustomerId && !sourceAddressId
        ? customerAddressTabLink(returnCustomerId, state)
        : ({
            to: "/addresses/$addressId",
            params: { addressId: sourceAddressId ?? address.id },
            search: { customerId: returnCustomerId },
            state: {
              addressListQuery: state.addressListQuery,
              customerListQuery: state.customerListQuery,
            },
          } as const);
    const source = state.addressEditSource;
    // 从原页面进入时回到已有历史记录，浏览器返回时就不会重复显示来源页。
    if (
      source?.index === state.__TSR_index - 1 &&
      source.href === router.buildLocation(destination).href &&
      router.history.canGoBack()
    ) {
      returning.current = true;
      router.history.back();
      return;
    }
    return navigate({ ...destination, replace: true });
  }

  return (
    <AddressEditForm
      key={address.id}
      address={address}
      onCancel={() => void returnToSource()}
      onSaved={async () => {
        // 保存完成时用户可能已通过浏览器返回或切换到了其他页面。
        const current = router.state.location;
        if (
          current.href !== location.href ||
          current.state.__TSR_key !== state.__TSR_key
        ) {
          return;
        }
        toastManager.add({ title: "地址已保存", type: "success" });
        await returnToSource();
      }}
    />
  );
}
