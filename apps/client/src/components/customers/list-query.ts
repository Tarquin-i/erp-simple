import type {
  CustomerFilterOperator,
  CustomerFilterValue,
  CustomerListQuery,
} from "@/request/customers";

declare module "@tanstack/react-router" {
  interface HistoryState {
    // 进入客户详情或表单时记住列表条件，返回时用它恢复列表。
    customerListQuery?: CustomerListQuery;
  }
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const customerFilterLimit = 100;

function searchText(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  return value.trim().replaceAll("\0", "").slice(0, maximum) || undefined;
}

export function customerFilterValues(value: CustomerFilterValue | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function customerFilterValue(values: string[]) {
  return values.length > 1 ? values : values[0];
}

export function customerFilterOperator(
  count: number,
  operator: unknown
): CustomerFilterOperator | undefined {
  if (!count) return undefined;
  const excluded = operator === "is not" || operator === "is none of";
  if (count === 1) return excluded ? "is not" : undefined;
  return excluded ? "is none of" : "is any of";
}

function readFilterValues(
  value: unknown,
  parse: (entry: unknown) => string | undefined
) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values.flatMap((entry) => {
        const parsed = parse(typeof entry === "number" ? String(entry) : entry);
        return parsed === undefined ? [] : [parsed];
      })
    ),
  ].slice(0, customerFilterLimit);
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
  const channels = readFilterValues(search.channelCode, (value) =>
    searchText(value, 64)
  );
  const tags = readFilterValues(search.tagId, (value) => {
    const tag = searchText(value, 36);
    return tag && uuidPattern.test(tag) ? tag.toLowerCase() : undefined;
  });
  const owners = readFilterValues(search.ownerUserId, (value) =>
    searchText(value, 128)
  );

  return {
    search: searchText(
      typeof search.search === "number" ? String(search.search) : search.search,
      256
    ),
    channelCode: customerFilterValue(channels),
    channelOperator: customerFilterOperator(
      channels.length,
      search.channelOperator
    ),
    tagId: customerFilterValue(tags),
    tagOperator: customerFilterOperator(tags.length, search.tagOperator),
    ownerUserId: customerFilterValue(owners),
    ownerOperator: customerFilterOperator(owners.length, search.ownerOperator),
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
