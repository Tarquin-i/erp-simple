import { queryString, request, write } from "./client";
import type { PageMetadata, PageQuery } from "./client";

export type CustomerTag = {
  id: string;
  name: string;
  color: string;
  canManage: boolean;
  departmentId: string | null;
  departmentName?: string | null;
};

export function listCustomerTags(
  query: PageQuery & { departmentId?: string } = {},
  signal?: AbortSignal
) {
  return request<PageMetadata & { tags: CustomerTag[] }>(
    `/tags${queryString(query)}`,
    { signal }
  );
}

/**
 * 按 ID 读取单个客户标签，供筛选器补查已选标签。
 * @param id 要查找的标签 ID。
 * @param signal 可选的请求取消信号。
 * @returns `{ tag }`，包含标签 ID、名称和颜色。
 * @throws HTTP 失败时抛出 `CustomerApiError`，标签不存在时状态码为 404。请求取消异常会传给调用方。
 */
export function getCustomerTag(id: string, signal?: AbortSignal) {
  return request<{ tag: CustomerTag }>(`/tags/${encodeURIComponent(id)}`, {
    signal,
  });
}

/**
 * 创建可供客户表单和筛选共用的标签。
 * @param input 标签名称及可选的 `#RRGGBB` 颜色。
 * @returns `{ tag }`，包含新标签的 ID、名称和颜色。
 * @throws HTTP 失败时抛出 `CustomerApiError`，标签重名的错误码为 `tag_name_exists`。
 */
export function createCustomerTag(input: {
  name: string;
  color?: string;
  departmentId?: string;
}) {
  return write<{ tag: CustomerTag }>("/tags", "POST", input);
}

export function updateCustomerTag(
  id: string,
  input: {
    name: string;
    color: string;
    expectedName: string;
    expectedColor: string;
  }
) {
  return write<{ tag: CustomerTag }>(
    `/tags/${encodeURIComponent(id)}`,
    "PATCH",
    input
  );
}

export function getCustomerTagUsage(id: string, signal?: AbortSignal) {
  return request<{ references: number }>(
    `/tags/${encodeURIComponent(id)}/usage`,
    { signal }
  );
}

export function deleteCustomerTag(
  id: string,
  input: { expectedName: string; expectedColor: string }
) {
  return write<{ deleted: true }>(
    `/tags/${encodeURIComponent(id)}`,
    "DELETE",
    input
  );
}
