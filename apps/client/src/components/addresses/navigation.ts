import type { AddressListQuery } from "@/request/addresses";

declare module "@tanstack/react-router" {
  interface HistoryState {
    addressListQuery?: AddressListQuery;
  }
}

/** 解析地址分页的 URL 参数，第一页使用默认值。 */
export function readAddressPage({ page }: Record<string, unknown>): {
  page?: number;
} {
  const number =
    typeof page === "number"
      ? page
      : typeof page === "string" && /^\d+$/u.test(page)
        ? Number(page)
        : undefined;
  return {
    page:
      number && Number.isInteger(number) && number > 1 && number <= 1_000_000
        ? number
        : undefined,
  };
}

/** 规范化地址目录的 URL 搜索条件。 */
export function readAddressListQuery(
  raw: Record<string, unknown>
): AddressListQuery {
  const search =
    typeof raw.search === "number" ? String(raw.search) : raw.search;
  return {
    ...readAddressPage(raw),
    search:
      typeof search === "string"
        ? search.replaceAll("\0", "").trim().slice(0, 128) || undefined
        : undefined,
  };
}
