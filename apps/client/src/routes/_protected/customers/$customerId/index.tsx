import {
  Link,
  createFileRoute,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback } from "react";

import { readCommunicationPage } from "@/components/communication/navigation";
import { CustomerDetail } from "@/components/customers/detail";
import { CustomerArchiveAction } from "@/components/customers/detail/archive-action";
import { CustomerProductsTab } from "@/components/customers/detail/products-tab";
import { isCustomerDetailTab } from "@/components/customers/detail/tabs";
import type { CustomerDetailTab } from "@/components/customers/detail/tabs";
import { readListQueryFromState } from "@/components/customers/list-query";
import {
  DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE,
  readCustomerProductPageSize,
  readProductPage,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerApiError, getCustomer } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/$customerId/")({
  validateSearch: (
    search: Record<string, unknown>
  ): {
    tab?: CustomerDetailTab;
    communicationPage?: number;
    productPage?: number;
    productPageSize?: number;
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
      productPageSize:
        tab === "products"
          ? readCustomerProductPageSize(search.productPageSize)
          : undefined,
    };
  },
  loader: ({ params, abortController }) =>
    getCustomer(params.customerId, abortController.signal),
  component: CustomerDetailRoute,
  pendingComponent: () => (
    <main
      aria-busy="true"
      aria-label="正在加载客户详情"
      className="min-w-0 flex-1 space-y-5 bg-background px-4 py-6 sm:px-6"
    >
      <div
        aria-hidden="true"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <Skeleton className="h-8 w-44" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-17.5 rounded-lg" />
          <Skeleton className="h-8 w-17.5 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-32 w-full" />
    </main>
  ),
  errorComponent: ({ error }) => <CustomerDetailError error={error} />,
});

function CustomerDetailRoute() {
  const { customer } = Route.useLoaderData();
  const { tab, productPage, productPageSize } = Route.useSearch();
  const { href, state } = useLocation();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const productLinkState = {
    productCustomerList: {
      customerId: customer.id,
      page: productPage,
      pageSize: productPageSize,
    },
    productListEntryIndex: state.__TSR_index,
    customerListQuery: readListQueryFromState(state),
  };

  const changeProductPage = useCallback(
    (page: number, replace?: boolean, size = productPageSize) => {
      const search = {
        tab: "products",
        productPage: readProductPage(page),
        productPageSize: readCustomerProductPageSize(size),
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
    [
      customer.id,
      href,
      navigate,
      productPageSize,
      router,
      state.productPreviousListHref,
    ]
  );

  return (
    <CustomerDetail
      key={customer.id}
      customer={customer}
      activeTab={tab ?? "contacts"}
      archiveAction={
        <CustomerArchiveAction
          customer={customer}
          onArchived={() => {
            void navigate({
              to: "/customers",
              search: readListQueryFromState(state),
              replace: true,
            });
          }}
        />
      }
      createProductAction={
        <Button asChild size="icon">
          <Link
            to="/products/new"
            search={{ customerId: customer.id, productPage, productPageSize }}
            state={productLinkState}
            aria-label="新建产品"
            title="新建产品"
            preload={false}
          >
            <Plus aria-hidden="true" />
          </Link>
        </Button>
      }
      productsTab={
        <CustomerProductsTab
          customerId={customer.id}
          page={productPage ?? 1}
          pageSize={productPageSize ?? DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE}
          onPageChange={changeProductPage}
          onPageSizeChange={(size) => changeProductPage(1, false, size)}
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
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={1}>
            {notFound ? "找不到该客户" : "暂时无法加载客户详情"}
          </EmptyTitle>
          {!notFound && (
            <p className="text-sm text-muted-foreground" role="alert">
              {error instanceof Error ? error.message : "请稍后重试。"}
            </p>
          )}
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link to="/customers" search={listQuery}>
              返回客户列表
            </Link>
          </Button>
          {!notFound && (
            <Button onClick={() => void router.invalidate()}>重试</Button>
          )}
        </div>
      </Empty>
    </main>
  );
}
