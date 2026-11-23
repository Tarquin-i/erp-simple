import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { ProductList } from "@/components/products/list";
import { readProductListQuery } from "@/components/products/navigation";
import type { ProductListQuery } from "@/request/products";

export const Route = createFileRoute("/_protected/products/")({
  validateSearch: readProductListQuery,
  component: ProductListPage,
});

function ProductListPage() {
  const query = Route.useSearch();
  const navigate = Route.useNavigate();
  const onQueryChange = useCallback(
    (
      update: (previous: ProductListQuery) => ProductListQuery,
      replace?: boolean
    ) => void navigate({ search: update, replace, resetScroll: false }),
    [navigate]
  );
  return (
    <ProductList
      query={query}
      onQueryChange={onQueryChange}
      onOpenProduct={(productId) =>
        void navigate({
          to: "/products/$productId",
          params: { productId },
          state: { productListQuery: query },
        })
      }
    />
  );
}
