import type { ParsedLocation } from "@tanstack/react-router";

import { isProductType } from "@/request/products";
import type { ProductListQuery } from "@/request/products";

declare module "@tanstack/react-router" {
  interface HistoryState {
    productListQuery?: ProductListQuery;
  }
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

export function readProductListQuery(
  search: Record<string, unknown>
): ProductListQuery {
  const query: ProductListQuery = {};
  const term =
    typeof search.search === "string" ? search.search.trim().slice(0, 256) : "";
  if (term) query.search = term;
  if (
    typeof search.customerId === "string" &&
    uuidPattern.test(search.customerId)
  ) {
    query.customerId = search.customerId.toLowerCase();
  }
  const values = Array.isArray(search.productTypes)
    ? search.productTypes
    : typeof search.productTypes === "string"
      ? search.productTypes.split(",")
      : [];
  const types = [...new Set(values.filter(isProductType))];
  if (types.length) query.productTypes = types;
  if (search.sortDirection === "asc") query.sortDirection = "asc";
  const page = positiveInteger(search.page, 1_000_000);
  const pageSize = positiveInteger(search.pageSize, 100);
  if (page && page !== 1) query.page = page;
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
