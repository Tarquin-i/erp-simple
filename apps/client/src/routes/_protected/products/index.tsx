import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useCallback } from "react";

import { ProductList } from "@/components/products/list";
import {
  readProductListQuery,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import type { ProductListQuery } from "@/request/products";

export const Route = createFileRoute("/_protected/products/")({
  validateSearch: readProductListQuery,
  component: ProductListPage,
});

function ProductListPage() {
  const query = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { state } = useLocation();
  const listOrigin = {
    productListQuery: query,
    productListEntryIndex: state.__TSR_index,
  };
  const onQueryChange = useCallback(
    (
      update: (previous: ProductListQuery) => ProductListQuery,
      replace?: boolean
    ) =>
      void navigate({
        search: update,
        state: replace
          ? true
          : { productPreviousListHref: router.state.location.href },
        replace,
        resetScroll: false,
      }),
    [navigate, router]
  );

  const correctPage = useCallback(
    (page: number) => {
      const search = { ...query, page: page > 1 ? page : undefined };
      const destination = router.buildLocation({ to: "/products", search });
      if (
        state.productPreviousListHref === destination.href &&
        router.history.canGoBack()
      ) {
        replaceProductEntryAndGoBack(router.history, destination.publicHref);
        return;
      }
      void navigate({ search, state: true, replace: true, resetScroll: false });
    },
    [navigate, query, router, state.productPreviousListHref]
  );

  return (
    <ProductList
      query={query}
      listOrigin={listOrigin}
      onQueryChange={onQueryChange}
      onPageCorrection={correctPage}
      onOpenProduct={(productId) =>
        void navigate({
          to: "/products/$productId",
          params: { productId },
          state: listOrigin,
        })
      }
    />
  );
}
