export type AddressCustomer = {
  id: string;
  companyName: string;
  customerNo: string;
};

export type AddressListItem = {
  id: string;
  customerId: string;
  customer: AddressCustomer;
  recipientName: string;
  phone: string;
  isDefault: boolean;
  updatedAt: string;
  version: number;
  formattedAddress: string;
};

export type ExpectedDefaultAddress = Pick<
  AddressListItem,
  "id" | "version"
> | null;

export type AddressWriteInput = {
  recipientName: string;
  phone: string;
  countryCode: string;
  province: string;
  city: string;
  district: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  remark: string;
  isDefault: boolean;
};

export type AddressDetail = AddressListItem &
  Omit<AddressWriteInput, "province"> & {
    phoneNormalized: string;
    province: string | null;
    status: "active" | "archived";
    createdAt: string;
  };

type AddressPagination = { page?: number; pageSize?: number };

export type AddressListQuery = AddressPagination & { search?: string };

type AddressPage = {
  addresses: AddressListItem[];
  total: number;
  page: number;
  pageSize: number;
};

type AddressResponse = { address: AddressDetail };

export class AddressApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly current?: unknown
  ) {
    super(message);
    this.name = "AddressApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new AddressApiError(
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

/**
 * 校验冲突响应中的地址快照，再让表单读取其版本和地址资料。
 * @param value 服务端错误响应中的 current 字段。
 * @param id 本次提交的地址 ID。如果未指定，仅校验快照本身。
 * @returns 快照具备完整字段，且在指定 ID 时与之匹配，返回 true。
 */
export function isAddressSnapshot(
  value: unknown,
  id?: string
): value is AddressDetail {
  if (typeof value !== "object" || value === null) return false;
  const address = value as Partial<AddressDetail>;
  const owner = address.customer;
  return (
    typeof address.id === "string" &&
    (id === undefined || address.id === id) &&
    typeof address.version === "number" &&
    Number.isInteger(address.version) &&
    address.version > 0 &&
    typeof address.customerId === "string" &&
    owner != null &&
    owner.id === address.customerId &&
    typeof owner.companyName === "string" &&
    typeof owner.customerNo === "string" &&
    typeof address.recipientName === "string" &&
    typeof address.phone === "string" &&
    typeof address.phoneNormalized === "string" &&
    typeof address.countryCode === "string" &&
    (address.province === null || typeof address.province === "string") &&
    typeof address.city === "string" &&
    (address.district === null || typeof address.district === "string") &&
    typeof address.addressLine1 === "string" &&
    (address.addressLine2 === null ||
      typeof address.addressLine2 === "string") &&
    (address.postalCode === null || typeof address.postalCode === "string") &&
    typeof address.remark === "string" &&
    typeof address.isDefault === "boolean" &&
    (address.status === "active" || address.status === "archived") &&
    typeof address.createdAt === "string" &&
    typeof address.updatedAt === "string" &&
    typeof address.formattedAddress === "string"
  );
}

/**
 * 查询当前账号可见客户的默认地址。
 * @param query 搜索词和分页条件。
 * @param signal 用于取消查询的信号。
 * @returns 默认地址摘要和分页信息。
 * @throws 请求返回失败状态时抛出 AddressApiError。
 */
export function listDefaultAddresses(
  query: AddressListQuery = {},
  signal?: AbortSignal
) {
  return request<AddressPage>(`/addresses${queryString(query)}`, { signal });
}

/**
 * 查询一个可见客户的全部有效地址。
 * @param customerId 客户 ID。
 * @param query 分页条件。
 * @param signal 用于取消查询的信号。
 * @returns 地址摘要、客户信息与分页信息。
 * @throws 客户不存在或不可见时抛出 404 对应的 AddressApiError。
 */
export function listCustomerAddresses(
  customerId: string,
  query: AddressPagination = {},
  signal?: AbortSignal
) {
  return request<AddressPage & { customer: AddressCustomer }>(
    `/customers/${encodeURIComponent(customerId)}/addresses${queryString(query)}`,
    { signal }
  );
}

/**
 * 获取一条有效地址的完整资料。
 * @param id 地址 ID。
 * @param signal 用于取消查询的信号。
 * @returns 包含地址详情的响应。
 * @throws 地址不存在、已归档或不可见时抛出 404 对应的 AddressApiError。
 */
export function getAddress(id: string, signal?: AbortSignal) {
  return request<AddressResponse>(`/addresses/${encodeURIComponent(id)}`, {
    signal,
  });
}

/**
 * 在指定客户下新建地址。
 * @param customerId 客户 ID。
 * @param input 完整的表单字段。
 * @param submissionId 本次提交的唯一标识，重试时复用。
 * @param expectedDefault 用户确认时看到的默认地址及版本，null 表示确认当前无默认。
 * @returns 包含已创建地址详情的响应。
 * @throws 替换默认地址尚未确认或确认后默认地址有变化时抛出 409 对应的 AddressApiError。
 */
export function createAddress(
  customerId: string,
  input: AddressWriteInput,
  submissionId: string,
  expectedDefault?: ExpectedDefaultAddress
) {
  return request<AddressResponse>("/addresses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submissionId,
    },
    body: JSON.stringify({ ...input, customerId, expectedDefault }),
  });
}

/**
 * 按已查看的版本更新地址字段或设为默认地址。
 * @param id 地址 ID。
 * @param expectedVersion 用户提交时依据的版本号。
 * @param patch 本次需要更新的字段。
 * @returns 包含更新后地址详情的响应。
 * @throws 版本冲突时抛出 409 对应的 AddressApiError，current 字段包含最新地址。
 */
export function updateAddress(
  id: string,
  expectedVersion: number,
  patch: Partial<AddressWriteInput>
) {
  return request<AddressResponse>(`/addresses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...patch,
      // 换国家时，表单用空字符串保留草稿里的清空意图，接口用省略表示。
      province:
        patch.countryCode !== undefined && patch.province === ""
          ? undefined
          : patch.province,
      expectedVersion,
    }),
  });
}

/**
 * 按已查看的版本归档一条地址。
 * @param id 地址 ID。
 * @param expectedVersion 用户确认归档时依据的版本号。
 * @returns 包含已归档地址的响应。
 * @throws 版本冲突时抛出 409 对应的 AddressApiError，current 字段包含最新地址。
 */
export function archiveAddress(id: string, expectedVersion: number) {
  return request<AddressResponse>(
    `/addresses/${encodeURIComponent(id)}${queryString({ expectedVersion })}`,
    { method: "DELETE" }
  );
}
