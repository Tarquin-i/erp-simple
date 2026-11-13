import type { CustomerListQuery } from "@/request/customers";

declare module "@tanstack/react-router" {
  interface HistoryState {
    customerListQuery?: CustomerListQuery;
  }
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function searchText(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  return value.trim().replaceAll("\0", "").slice(0, maximum) || undefined;
}

export function parseListQuery(
  search: Record<string, unknown>
): CustomerListQuery {
  const page =
    typeof search.page === "number"
      ? search.page
      : typeof search.page === "string" && /^\d+$/.test(search.page)
        ? Number(search.page)
        : undefined;
  const tagId = searchText(search.tagId, 36);

  return {
    search: searchText(
      typeof search.search === "number" ? String(search.search) : search.search,
      256
    ),
    channelCode: searchText(search.channelCode, 64),
    tagId: tagId && uuidPattern.test(tagId) ? tagId.toLowerCase() : undefined,
    ownerUserId: searchText(search.ownerUserId, 128),
    page:
      page !== undefined &&
      Number.isInteger(page) &&
      page > 1 &&
      page <= 1_000_000
        ? page
        : undefined,
  };
}

export function readListQueryFromState(state: unknown): CustomerListQuery {
  if (!state || typeof state !== "object" || !("customerListQuery" in state))
    return {};
  const query = state.customerListQuery;
  return query && typeof query === "object"
    ? parseListQuery(query as Record<string, unknown>)
    : {};
}
