import type { HistoryState } from "@tanstack/react-router";

import { readListQueryFromState } from "@/components/customers/list-query";
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

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** 解析地址详情的页码和来源客户，来源仅用于返回导航。 */
export function readAddressDetailSearch(raw: Record<string, unknown>): {
  page?: number;
  customerId?: string;
} {
  const { customerId } = raw;
  return {
    ...readAddressPage(raw),
    customerId:
      typeof customerId === "string" && uuidPattern.test(customerId)
        ? customerId.toLowerCase()
        : undefined,
  };
}

/** 返回客户的地址 Tab，并保留客户列表条件和该 Tab 的页码。 */
export function customerAddressTabLink(
  customerId: string,
  page: number | undefined,
  state: HistoryState
) {
  return {
    to: "/customers/$customerId",
    params: { customerId },
    search: { tab: "addresses", addressPage: readAddressPage({ page }).page },
    state: { customerListQuery: readListQueryFromState(state) },
    preload: false,
  } as const;
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
