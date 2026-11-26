import {
  listOptionOperator,
  listOptionValue,
  readListOptionValues,
} from "@/lib/list-option-query";
import { readListPageSize } from "@/lib/list-page-size";
import type { CustomerListQuery } from "@/request/customers";

export {
  listOptionLimit as customerFilterLimit,
  listOptionOperator as customerFilterOperator,
  listOptionValue as customerFilterValue,
  listOptionValues as customerFilterValues,
} from "@/lib/list-option-query";

declare module "@tanstack/react-router" {
  interface HistoryState {
    // 进入客户详情或表单时记住列表条件，返回时用它恢复列表。
    customerListQuery?: CustomerListQuery;
  }
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function searchText(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  return value.trim().replaceAll("\0", "").slice(0, maximum) || undefined;
}

/**
 * 清理路由搜索参数，生成可用于客户列表请求的查询条件。
 * @param search 从 URL 或导航历史读取的原始参数。
 * @returns 规范化的搜索词、筛选条件和分页参数。无效值和默认值用 `undefined` 表示。
 */
export function parseListQuery(
  search: Record<string, unknown>
): CustomerListQuery {
  const page =
    typeof search.page === "number"
      ? search.page
      : typeof search.page === "string" && /^\d+$/.test(search.page)
        ? Number(search.page)
        : undefined;
  const channels = readListOptionValues(search.channelCode, (value) =>
    searchText(value, 64)
  );
  const tags = readListOptionValues(search.tagId, (value) => {
    const tag = searchText(value, 36);
    return tag && uuidPattern.test(tag) ? tag.toLowerCase() : undefined;
  });
  const owners = readListOptionValues(search.ownerUserId, (value) =>
    searchText(value, 128)
  );

  return {
    search: searchText(
      typeof search.search === "number" ? String(search.search) : search.search,
      256
    ),
    channelCode: listOptionValue(channels),
    channelOperator: listOptionOperator(
      channels.length,
      search.channelOperator
    ),
    tagId: listOptionValue(tags),
    tagOperator: listOptionOperator(tags.length, search.tagOperator),
    ownerUserId: listOptionValue(owners),
    ownerOperator: listOptionOperator(owners.length, search.ownerOperator),
    page:
      page !== undefined &&
      Number.isInteger(page) &&
      page > 1 &&
      page <= 1_000_000
        ? page
        : undefined,
    pageSize: readListPageSize(search.pageSize),
  };
}

/**
 * 读取进入客户详情或表单时保存的列表条件，供返回列表时恢复。
 * @param state 当前路由的历史状态。
 * @returns 重新校验后的搜索、筛选和分页条件。历史中没有可用的条件对象时返回空对象。
 */
export function readListQueryFromState(state: unknown): CustomerListQuery {
  if (!state || typeof state !== "object" || !("customerListQuery" in state))
    return {};
  const query = state.customerListQuery;
  return query && typeof query === "object"
    ? parseListQuery(query as Record<string, unknown>)
    : {};
}
