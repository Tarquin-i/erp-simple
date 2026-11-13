export type CustomerChannel = { code: string; name: string; color: string };
export type CustomerTag = { id: string; name: string; color: string };
export type CustomerOwner = { id: string; name: string };

export type Customer = {
  id: string;
  customerNo: string;
  companyName: string;
  remark: string | null;
  departmentId: string;
  ownerUserId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  channels: CustomerChannel[];
  tags: CustomerTag[];
};

type PageQuery = { search?: string; page?: number; pageSize?: number };
type PageMetadata = { page: number; pageSize: number; total: number };

export type CustomerListQuery = PageQuery & {
  channelCode?: string;
  tagId?: string;
  ownerUserId?: string;
};

export type CustomerWriteInput = {
  companyName?: string;
  remark?: string | null;
  channelCodes?: string[];
  tagIds?: string[];
  ownerUserId?: string;
};

export type CustomerContactMethodType =
  | "phone"
  | "email"
  | "wechat"
  | "whatsapp"
  | "linkedin"
  | "kingwin_alibaba"
  | "kingwin_international_station"
  | "huivo_international_station";

export type CustomerContactMethodInput = {
  type: CustomerContactMethodType;
  value: string;
  isPrimary?: boolean;
};

export type CustomerContactMethod = CustomerContactMethodInput & {
  id: string;
  contactId: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerContact = {
  id: string;
  customerId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  methods: CustomerContactMethod[];
};

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

const base = "/api/customers";

/**
 * 发送同源客户模块请求，统一解析 JSON 响应和业务错误。
 * @param path 相对于 `/api/customers` 的路径，可带查询参数。
 * @param options Fetch 请求选项，可包含用于取消请求的 `signal`。
 * @returns 成功响应中的 JSON 数据。
 * @throws HTTP 失败时抛出 `CustomerApiError`，保留状态码、业务错误码和服务端提供的 `current`。网络、取消和成功响应的 JSON 解析异常继续抛出。
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, options);
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new CustomerApiError(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
    response.status,
    typeof body?.code === "string" ? body.code : undefined,
    body?.current
  );
}

function queryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.size ? `?${params}` : "";
}

function write<T>(path: string, method: "POST" | "PATCH", body: object) {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const customerPath = (id: string) => `/${encodeURIComponent(id)}`;
const contactsPath = (customerId: string) =>
  `${customerPath(customerId)}/contacts`;
const contactPath = (customerId: string, contactId: string) =>
  `${contactsPath(customerId)}/${encodeURIComponent(contactId)}`;

export function listCustomers(query: CustomerListQuery, signal?: AbortSignal) {
  return request<PageMetadata & { customers: Customer[] }>(queryString(query), {
    signal,
  });
}

export function getCustomer(id: string, signal?: AbortSignal) {
  return request<{ customer: Customer }>(customerPath(id), { signal });
}

/**
 * 新建客户。
 * @param input 客户名称及表单字段。公司管理员新建时还需传目标部门和业务员。
 * @returns `{ customer }`，其中包含服务端生成的客户编号和版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，同部门重名的错误码为 `duplicate_customer`。
 */
export function createCustomer(
  input: CustomerWriteInput & { companyName: string; departmentId?: string }
) {
  return write<{ customer: Customer }>("", "POST", input);
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

export function listCustomerChannels(signal?: AbortSignal) {
  return request<{ channels: CustomerChannel[] }>("/channels", { signal });
}

export function listCustomerTags(query: PageQuery = {}, signal?: AbortSignal) {
  return request<PageMetadata & { tags: CustomerTag[] }>(
    `/tags${queryString(query)}`,
    { signal }
  );
}

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
export function createCustomerTag(input: { name: string; color?: string }) {
  return write<{ tag: CustomerTag }>("/tags", "POST", input);
}

export function listCustomerOwners(signal?: AbortSignal) {
  return request<{ owners: CustomerOwner[] }>("/owners", { signal });
}

/**
 * 查询客户表单可指派的业务员选项。
 * @param customerId 编辑时传入，按该客户原部门查询。
 * @param signal 可选的请求取消信号。
 * @param departmentId 公司管理员新建时选择的部门 ID。两种 ID 都省略时，主管按本人部门查询。
 * @returns `{ owners }`，包含服务端允许指派的成员 ID 和姓名。
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

export function listCustomerContacts(customerId: string, signal?: AbortSignal) {
  return request<{ contacts: CustomerContact[] }>(contactsPath(customerId), {
    signal,
  });
}

export function createCustomerContact(
  customerId: string,
  input: { name: string; methods: CustomerContactMethodInput[] }
) {
  return write<{ contact: CustomerContact }>(
    contactsPath(customerId),
    "POST",
    input
  );
}

/**
 * 修改联系人姓名。
 * @param customerId 所属客户 ID。
 * @param contactId 要改名的联系人 ID。
 * @param input 新姓名和联系人版本 `expectedVersion`。
 * @returns `{ contact }`，包含更新后的联系人、联系方式和版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function updateCustomerContact(
  customerId: string,
  contactId: string,
  input: { name: string; expectedVersion: number }
) {
  return write<{ contact: CustomerContact }>(
    contactPath(customerId, contactId),
    "PATCH",
    input
  );
}

/**
 * 为已有联系人添加一种联系方式。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param input 联系方式字段和联系人版本 `expectedVersion`。
 * @returns `{ contact }`，包含更新后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，包括同类型联系方式重复或版本冲突。
 */
export function createCustomerContactMethod(
  customerId: string,
  contactId: string,
  input: CustomerContactMethodInput & { expectedVersion: number }
) {
  return write<{ contact: CustomerContact }>(
    `${contactPath(customerId, contactId)}/methods`,
    "POST",
    input
  );
}

/**
 * 提交一条联系方式的部分更新。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param methodId 要修改的联系方式 ID。
 * @param input 变更字段和联系人版本 `expectedVersion`。
 * @returns `{ contact }`，包含更新后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function updateCustomerContactMethod(
  customerId: string,
  contactId: string,
  methodId: string,
  input: Partial<CustomerContactMethodInput> & { expectedVersion: number }
) {
  return write<{ contact: CustomerContact }>(
    `${contactPath(customerId, contactId)}/methods/${encodeURIComponent(methodId)}`,
    "PATCH",
    input
  );
}

/**
 * 删除一条联系方式，将联系人版本通过查询参数提交。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param methodId 要删除的联系方式 ID。
 * @param expectedVersion 提交所依据的联系人版本。
 * @returns `{ contact }`，包含删除后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function deleteCustomerContactMethod(
  customerId: string,
  contactId: string,
  methodId: string,
  expectedVersion: number
) {
  const path = `${contactPath(customerId, contactId)}/methods/${encodeURIComponent(methodId)}`;
  return request<{ contact: CustomerContact }>(
    `${path}${queryString({ expectedVersion })}`,
    { method: "DELETE" }
  );
}
