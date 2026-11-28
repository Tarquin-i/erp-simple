import {
  customerBasePath,
  customerPath,
  queryString,
  request,
  write,
} from "./client";
import type { PageMetadata, PageQuery } from "./client";
import type { CustomerTag } from "./tags";

export type CustomerChannel = { code: string; name: string; color: string };
export type CustomerOwner = { id: string; name: string };

export type Customer = {
  id: string;
  customerNo: string;
  companyName: string;
  remark: string | null;
  departmentId: string;
  ownerUserId: string;
  ownerName: string;
  status: "active" | "archived";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  channels: CustomerChannel[];
  tags: CustomerTag[];
};

export type CustomerFilterOperator =
  | "is"
  | "is not"
  | "is any of"
  | "is none of";
export type CustomerFilterValue = string | string[];

export type CustomerListQuery = PageQuery & {
  channelCode?: CustomerFilterValue;
  channelOperator?: CustomerFilterOperator;
  tagId?: CustomerFilterValue;
  tagOperator?: CustomerFilterOperator;
  ownerUserId?: CustomerFilterValue;
  ownerOperator?: CustomerFilterOperator;
};

export type CustomerWriteInput = {
  companyName?: string;
  remark?: string | null;
  channelCodes?: string[];
  tagIds?: string[];
  ownerUserId?: string;
};

const customerListGetTargetLimit = 8_000;

/**
 * 按搜索、筛选和分页条件请求当前账号可见的客户。
 * @param query 搜索词、渠道、标签、业务员、页码和每页条数，均可省略。
 * @param signal 可选的请求取消信号，供列表切换查询条件时使用。
 * @returns 当前页的 `customers`、总数 `total`、页码 `page` 和每页条数 `pageSize`。
 * @throws HTTP 失败时抛出 `CustomerApiError`，取消或网络异常由调用方处理。
 */
export function listCustomers(query: CustomerListQuery, signal?: AbortSignal) {
  const suffix = queryString(query);
  // URLSearchParams 的输出已编码为 ASCII，长度可直接作为请求路径字节数。
  if (customerBasePath.length + suffix.length > customerListGetTargetLimit) {
    const body = Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== "")
    );
    return request<PageMetadata & { customers: Customer[] }>("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }
  return request<PageMetadata & { customers: Customer[] }>(suffix, { signal });
}

export function getCustomer(id: string, signal?: AbortSignal) {
  return request<{ customer: Customer }>(customerPath(id), { signal });
}

/**
 * 新建客户。
 * @param input 客户名称及表单字段。公司管理员新建时还需传目标部门和业务员。
 * @param submissionId 同一份资料重试时复用的提交 ID。
 * @returns `{ customer }`，其中包含服务端生成的客户编号和版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，同部门重名的错误码为 `duplicate_customer`。
 */
export function createCustomer(
  input: CustomerWriteInput & { companyName: string; departmentId?: string },
  submissionId: string
) {
  return request<{ customer: Customer }>("", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submissionId,
    },
    body: JSON.stringify(input),
  });
}

/**
 * 提交客户资料的部分更新，并由服务端检查版本。
 * @param id 要更新的客户 ID。
 * @param input 变更字段和提交所依据的客户版本 `expectedVersion`。确认覆盖时传最新快照的版本。
 * @returns `{ customer }`，包含更新后的完整客户资料和版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`。版本冲突的错误码为 `version_conflict`，`current` 包含最新资料。
 */
export function updateCustomer(
  id: string,
  input: CustomerWriteInput & { expectedVersion: number }
) {
  return write<{ customer: Customer }>(customerPath(id), "PATCH", input);
}

export function archiveCustomer(id: string, expectedVersion: number) {
  return request<{ customer: Customer }>(
    `${customerPath(id)}${queryString({ expectedVersion })}`,
    { method: "DELETE" }
  );
}

export function listCustomerChannels(signal?: AbortSignal) {
  return request<{ channels: CustomerChannel[] }>("/channels", { signal });
}

export function listCustomerOwners(signal?: AbortSignal) {
  return request<{ owners: CustomerOwner[] }>("/owners", { signal });
}

/**
 * 查询客户表单可指派的业务员选项。`customerId` 和 `departmentId` 按使用场景择一传入。
 * @param customerId 编辑时传入，按该客户原部门查询。
 * @param signal 可选的请求取消信号。
 * @param departmentId 公司管理员新建时选择的部门 ID。
 * @returns `{ owners }`，包含可指派成员的 ID 和姓名。两个 ID 都省略时，主管取得本部门名单，管理员和普通员工取得空数组。
 * @throws HTTP 失败时抛出 `CustomerApiError`。请求被取消时向调用方抛出取消异常。
 */
export function listAssignableCustomerOwners(
  customerId?: string,
  signal?: AbortSignal,
  departmentId?: string
) {
  const path = customerId ? customerPath(customerId) : "";
  return request<{ owners: CustomerOwner[] }>(
    `${path}/assignable-owners${queryString({ departmentId })}`,
    { signal }
  );
}
