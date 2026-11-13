import type { CustomerListQuery } from "@/request/customers";

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
 * @returns 规范化的搜索词、筛选条件和页码。无效值和默认的第一页用 `undefined` 表示。
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
