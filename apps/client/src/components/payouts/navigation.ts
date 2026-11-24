import { readProductPage } from "@/components/products/navigation";
import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import type {
  ListOptionOperator,
  ListOptionValue,
} from "@/lib/list-option-query";

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export type PayoutListSearch = {
  productId?: ListOptionValue;
  productOperator?: ListOptionOperator;
  page?: number;
};

export function readPayoutListSearch({
  productId,
  productOperator,
  page,
}: Record<string, unknown>): PayoutListSearch {
  const products = readListOptionValues(productId, (value) =>
    typeof value === "string" && uuidPattern.test(value)
      ? value.toLowerCase()
      : undefined
  );
  return {
    productId: listOptionValue(products),
    productOperator: listOptionOperator(products.length, productOperator),
    page: readProductPage(page),
  };
}

export function payoutListOrigin(query: PayoutListSearch) {
  return {
    listProductId: query.productId,
    listProductOperator: query.productOperator,
    listPage: query.page,
  };
}

export function payoutListSearchFromOrigin(search: Record<string, unknown>) {
  return readPayoutListSearch({
    productId: search.listProductId,
    productOperator: search.listProductOperator,
    page: search.listPage,
  });
}

export function readPayoutListOrigin(search: Record<string, unknown>) {
  return payoutListOrigin(payoutListSearchFromOrigin(search));
}
