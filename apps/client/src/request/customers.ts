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

export function createCustomer(
  input: CustomerWriteInput & { companyName: string }
) {
  return write<{ customer: Customer }>("", "POST", input);
}

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

export function createCustomerTag(input: { name: string; color?: string }) {
  return write<{ tag: CustomerTag }>("/tags", "POST", input);
}

export function listCustomerOwners(signal?: AbortSignal) {
  return request<{ owners: CustomerOwner[] }>("/owners", { signal });
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
