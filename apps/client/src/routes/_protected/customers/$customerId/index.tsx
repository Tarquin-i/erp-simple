import {
  Link,
  createFileRoute,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";

import { readCommunicationPage } from "@/components/communication/navigation";
import { CustomerDetail } from "@/components/customers/detail";
import { CustomerProductsTab } from "@/components/customers/detail/products-tab";
import { isCustomerDetailTab } from "@/components/customers/detail/tabs";
import type { CustomerDetailTab } from "@/components/customers/detail/tabs";
import { readListQueryFromState } from "@/components/customers/list-query";
import {
  readProductPage,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerApiError, getCustomer } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/$customerId/")({
  validateSearch: (
    search: Record<string, unknown>
  ): {
    tab?: CustomerDetailTab;
    communicationPage?: number;
    productPage?: number;
  } => {
    const tab =
      isCustomerDetailTab(search.tab) && search.tab !== "contacts"
        ? search.tab
        : undefined;
    return {
      tab,
      communicationPage:
        tab === "communication"
          ? readCommunicationPage(search.communicationPage)
          : undefined,
      productPage:
        tab === "products" ? readProductPage(search.productPage) : undefined,
    };
  },
  loader: ({ params, abortController }) =>
    getCustomer(params.customerId, abortController.signal),
  component: CustomerDetailRoute,
  pendingComponent: () => (
    <main
      className="flex-1 space-y-5 bg-background p-6"
      aria-label="正在加载客户详情"
    >
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-32 w-full" />
    </main>
  ),
  errorComponent: ({ error }) => <CustomerDetailError error={error} />,
});

function CustomerDetailRoute() {
  const { customer } = Route.useLoaderData();
  const { tab, productPage } = Route.useSearch();
  const { href, state } = useLocation();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const productLinkState = {
    productCustomerList: { customerId: customer.id, page: productPage },
    productListEntryIndex: state.__TSR_index,
    customerListQuery: readListQueryFromState(state),
  };

  const changeProductPage = useCallback(
    (page: number, replace?: boolean) => {
      const search = {
        tab: "products",
        productPage: readProductPage(page),
      } as const;
      if (
        replace &&
        state.productPreviousListHref &&
        router.history.canGoBack()
      ) {
        const destination = router.buildLocation({
          to: "/customers/$customerId",
          params: { customerId: customer.id },
          search,
        });
        if (state.productPreviousListHref === destination.href) {
          replaceProductEntryAndGoBack(router.history, destination.publicHref);
          return;
        }
      }
      void navigate({
        search,
        state: (previous) => ({
          ...previous,
          productPreviousListHref: replace
            ? previous.productPreviousListHref
            : href,
        }),
        resetScroll: false,
        replace,
      });
    },
    [customer.id, href, navigate, router, state.productPreviousListHref]
  );

  return (
    <CustomerDetail
      key={customer.id}
      customer={customer}
      activeTab={tab ?? "contacts"}
      productsTab={
        <CustomerProductsTab
          customerId={customer.id}
          page={productPage ?? 1}
          onPageChange={changeProductPage}
          productLinkState={productLinkState}
          onOpenProduct={(productId) =>
            void navigate({
              to: "/products/$productId",
              params: { productId },
              state: productLinkState,
            })
          }
        />
      }
      onTabChange={(value) =>
        void navigate({
          search: { tab: value === "contacts" ? undefined : value },
          state: (previous) => previous,
          resetScroll: false,
          replace: true,
        })
      }
    />
  );
}

function CustomerDetailError({ error }: { error: unknown }) {
  const router = useRouter();
  const listQuery = readListQueryFromState(
    useRouterState({ select: (state) => state.location.state })
  );
  const notFound = error instanceof CustomerApiError && error.status === 404;

  return (
    <main className="flex-1 space-y-4 bg-background p-6">
      <h1 className="text-xl font-semibold">
        {notFound ? "找不到该客户" : "暂时无法加载客户详情"}
      </h1>
      {!notFound && (
        <p className="text-sm text-muted-foreground" role="alert">
          {error instanceof Error ? error.message : "请稍后重试。"}
        </p>
      )}
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/customers" search={listQuery}>
            返回客户列表
          </Link>
        </Button>
        {!notFound && (
          <Button onClick={() => void router.invalidate()}>重试</Button>
        )}
      </div>
    </main>
  );
}
