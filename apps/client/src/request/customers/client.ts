export type PageQuery = { search?: string; page?: number; pageSize?: number };
export type PageMetadata = { page: number; pageSize: number; total: number };

export class CustomerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly current?: unknown
  ) {
    super(message);
    this.name = "CustomerApiError";
  }
}

export const customerBasePath = "/api/customers";

/**
 * 发送同源客户模块请求，统一解析 JSON 响应和业务错误。
 * @param path 相对于 `/api/customers` 的路径，可带查询参数。
 * @param options Fetch 请求选项，可包含用于取消请求的 `signal`。
 * @returns 成功响应中的 JSON 数据。
 * @throws HTTP 失败时抛出 `CustomerApiError`，保留状态码、业务错误码和服务端提供的 `current`。网络、取消和成功响应的 JSON 解析异常继续抛出。
 */
export async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${customerBasePath}${path}`, options);
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new CustomerApiError(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
    response.status,
    typeof body?.code === "string" ? body.code : undefined,
    body?.current
  );
}

export function queryString(
  query: Record<string, string | string[] | number | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.size ? `?${params}` : "";
}

export function write<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: object
) {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const customerPath = (id: string) => `/${encodeURIComponent(id)}`;
