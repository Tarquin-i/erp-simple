import type {
  HistoryState,
  ParsedLocation,
  RouterHistory,
} from "@tanstack/react-router";

import { isProductType } from "@/request/products";
import type { ProductListQuery } from "@/request/products";

declare module "@tanstack/react-router" {
  interface HistoryState {
    productListQuery?: ProductListQuery;
    productListEntryIndex?: number;
    productCustomerList?: { customerId: string; page?: number };
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
        search: { tab: "products", productPage: origin.page },
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

function readProductCustomerId(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function readNewProductSearch(search: Record<string, unknown>): {
  customerId?: string;
  productPage?: number;
} {
  const customerId = readProductCustomerId(search.customerId);
  return {
    customerId,
    productPage: customerId ? readProductPage(search.productPage) : undefined,
  };
}

export function readProductListQuery(
  search: Record<string, unknown>
): ProductListQuery {
  const query: ProductListQuery = {};
  const term =
    typeof search.search === "string" ? search.search.trim().slice(0, 256) : "";
  if (term) query.search = term;
  const customerId = readProductCustomerId(search.customerId);
  if (customerId) query.customerId = customerId;
  const values = Array.isArray(search.productTypes)
    ? search.productTypes
    : typeof search.productTypes === "string"
      ? search.productTypes.split(",")
      : [];
  const types = [...new Set(values.filter(isProductType))];
  if (types.length) query.productTypes = types;
  if (search.sortDirection === "asc") query.sortDirection = "asc";
  const page = readProductPage(search.page);
  const pageSize = positiveInteger(search.pageSize, 100);
  if (page) query.page = page;
  if (pageSize && pageSize !== 20) query.pageSize = pageSize;
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
