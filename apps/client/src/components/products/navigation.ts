import type {
  HistoryState,
  ParsedLocation,
  RouterHistory,
} from "@tanstack/react-router";

import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import { readListPageSize } from "@/lib/list-page-size";
import { isProductType } from "@/request/products";
import type { ProductListQuery } from "@/request/products";

declare module "@tanstack/react-router" {
  interface HistoryState {
    productListQuery?: ProductListQuery;
    productListEntryIndex?: number;
    productCustomerList?: {
      customerId: string;
      page?: number;
      pageSize?: number;
    };
    productPreviousListHref?: string;
    discardedProductListEntry?: true;
  }
}

export function productListOrigin(state: HistoryState): HistoryState {
  return {
    productListQuery: state.productListQuery,
    productListEntryIndex: state.productListEntryIndex,
    productCustomerList: state.productCustomerList,
    customerListQuery: state.productCustomerList
      ? state.customerListQuery
      : undefined,
  };
}

/** 根据入口返回原产品列表或客户的产品页签。 */
export function productListDestination(state: HistoryState) {
  const origin = state.productCustomerList;
  return origin
    ? ({
        to: "/customers/$customerId",
        params: { customerId: origin.customerId },
        search: {
          tab: "products",
          productPage: origin.page,
          productPageSize: origin.pageSize,
        },
        state: { customerListQuery: state.customerListQuery },
      } as const)
    : ({ to: "/products", search: state.productListQuery ?? {} } as const);
}

/** 改写失效的历史记录，返回已经存在的列表。 */
export function replaceProductEntryAndGoBack(
  history: RouterHistory,
  href: string
) {
  history.replace(
    href,
    { discardedProductListEntry: true },
    { ignoreBlocker: true }
  );
  history.flush();
  history.back();
}

/** 避免前进时重新进入归档或页码修正留下的列表副本。 */
export function blockDiscardedProductListEntries(history: RouterHistory) {
  history.block({
    enableBeforeUnload: false,
    blockerFn: ({ action, currentLocation, nextLocation }) =>
      (action === "FORWARD" || action === "GO") &&
      nextLocation.state.__TSR_index > currentLocation.state.__TSR_index &&
      nextLocation.state.discardedProductListEntry === true,
  });
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

function positiveInteger(value: unknown, max: number) {
  const number =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  return typeof number === "number" &&
    Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= max
    ? number
    : undefined;
}

export function readProductPage(value: unknown) {
  const page = positiveInteger(value, 1_000_000);
  return page === 1 ? undefined : page;
}

export const DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE = 5;

export function readCustomerProductPageSize(value: unknown) {
  const size = positiveInteger(value, 100);
  return size === DEFAULT_CUSTOMER_PRODUCT_PAGE_SIZE ? undefined : size;
}

function readProductCustomerId(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function readNewProductSearch(search: Record<string, unknown>): {
  customerId?: string;
  productPage?: number;
  productPageSize?: number;
} {
  const customerId = readProductCustomerId(search.customerId);
  return {
    customerId,
    productPage: customerId ? readProductPage(search.productPage) : undefined,
    productPageSize: customerId
      ? readCustomerProductPageSize(search.productPageSize)
      : undefined,
  };
}

export function readProductListQuery(
  search: Record<string, unknown>
): ProductListQuery {
  // 路由会合并原始搜索参数，显式清除旧链接里的排序方向。
  const query: ProductListQuery = { sortDirection: undefined };
  const term =
    typeof search.search === "string" ? search.search.trim().slice(0, 256) : "";
  if (term) query.search = term;
  const customers = readListOptionValues(
    search.customerId,
    readProductCustomerId
  );
  if (customers.length) {
    query.customerId = listOptionValue(customers);
    const operator = listOptionOperator(
      customers.length,
      search.customerOperator
    );
    if (operator) query.customerOperator = operator;
  }
  const values = [search.productTypes, search.productType].flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
  const types = [
    ...new Set(
      values
        .flatMap((value) =>
          typeof value === "string"
            ? value.split(",").map((type) => type.trim())
            : []
        )
        .filter(isProductType)
    ),
  ];
  if (types.length) {
    query.productTypes = types;
    const operator = listOptionOperator(
      types.length,
      search.productTypeOperator
    );
    if (operator) query.productTypeOperator = operator;
  }
  const page = readProductPage(search.page);
  if (page) query.page = page;
  query.pageSize = readListPageSize(search.pageSize);
  return query;
}

/** 离开页面后忽略已发送写入的迟到响应。 */
export function isSameProductEntry(
  current: ParsedLocation,
  start: ParsedLocation
) {
  return (
    current.href === start.href &&
    current.state.__TSR_key === start.state.__TSR_key
  );
}
