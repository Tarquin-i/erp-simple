import type { HistoryState } from "@tanstack/react-router";

import { readListQueryFromState } from "@/components/customers/list-query";
import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import type { AddressListQuery } from "@/request/addresses";

declare module "@tanstack/react-router" {
  interface HistoryState {
    addressListQuery?: AddressListQuery;
  }
}

/** 解析侧栏地址目录的 URL 页码，第一页使用默认值。 */
function readAddressPage({ page }: Record<string, unknown>): {
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

function readAddressRouteId(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** 解析地址详情的来源客户，用于返回导航。 */
export function readAddressDetailSearch(raw: Record<string, unknown>): {
  customerId?: string;
} {
  return {
    customerId: readAddressRouteId(raw.customerId),
  };
}

/** 解析新建地址的来源与客户，供加载与返回使用。 */
export function readNewAddressSearch(raw: Record<string, unknown>): {
  customerId?: string;
  sourceAddressId?: string;
} {
  return {
    ...readAddressDetailSearch(raw),
    sourceAddressId: readAddressRouteId(raw.sourceAddressId),
  };
}

/** 返回客户的地址 Tab，并保留客户列表条件。 */
export function customerAddressTabLink(
  customerId: string,
  state: HistoryState
) {
  return {
    to: "/customers/$customerId",
    params: { customerId },
    search: { tab: "addresses" },
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
  const owners = readListOptionValues(raw.ownerUserId, (value) =>
    typeof value === "string"
      ? value.replaceAll("\0", "").trim().slice(0, 128) || undefined
      : undefined
  );
  return {
    ...readAddressPage(raw),
    search:
      typeof search === "string"
        ? search.replaceAll("\0", "").trim().slice(0, 128) || undefined
        : undefined,
    ownerUserId: listOptionValue(owners),
    ownerOperator: listOptionOperator(owners.length, raw.ownerOperator),
  };
}
