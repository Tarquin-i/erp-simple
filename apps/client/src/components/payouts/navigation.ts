import { useLocation, useRouter } from "@tanstack/react-router";

import {
  readProductPage,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import type { PayoutListQuery } from "@/request/payouts";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

declare module "@tanstack/react-router" {
  interface HistoryState {
    payoutListEntryIndex?: number;
  }
}

export type PayoutListSearch = Omit<PayoutListQuery, "pageSize">;

export function readPayoutListSearch({
  search,
  productId,
  productOperator,
  page,
}: Record<string, unknown>): PayoutListSearch {
  const products = readListOptionValues(productId, (value) =>
    typeof value === "string" && uuidPattern.test(value)
      ? value.toLowerCase()
      : undefined
  );
  const term = typeof search === "string" ? search.trim().slice(0, 256) : "";
  return {
    search: term || undefined,
    productId: listOptionValue(products),
    productOperator: listOptionOperator(products.length, productOperator),
    page: readProductPage(page),
  };
}

export function payoutListOrigin(query: PayoutListSearch) {
  return {
    listSearch: query.search,
    listProductId: query.productId,
    listProductOperator: query.productOperator,
    listPage: query.page,
  };
}

export function payoutListSearchFromOrigin(search: Record<string, unknown>) {
  return readPayoutListSearch({
    search: search.listSearch,
    productId: search.listProductId,
    productOperator: search.listProductOperator,
    page: search.listPage,
  });
}

export function readPayoutListOrigin(search: Record<string, unknown>) {
  return payoutListOrigin(payoutListSearchFromOrigin(search));
}

export function useReturnToPayoutList() {
  const router = useRouter();
  const { search, state } = useLocation();

  return (discard = false) => {
    const destination = {
      to: "/payouts",
      search: payoutListSearchFromOrigin(search),
    } as const;
    if (
      state.payoutListEntryIndex === state.__TSR_index - 1 &&
      router.history.canGoBack()
    ) {
      if (discard) {
        const { publicHref } = router.buildLocation(destination);
        replaceProductEntryAndGoBack(router.history, publicHref);
      } else {
        router.history.back();
      }
      return;
    }
    void router.navigate({
      ...destination,
      replace: true,
      ignoreBlocker: discard,
    });
  };
}
