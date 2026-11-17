export type CommunicationStatus = "pending" | "urgent" | "completed";

export const communicationStatusLabels: Record<CommunicationStatus, string> = {
  pending: "待跟进",
  urgent: "急需跟进",
  completed: "已完结",
};

export type CommunicationTag = { id: string; name: string; color: string };

type CommunicationCustomer = {
  id: string;
  companyName: string;
  customerNo: string;
};

export type CommunicationListTag = Pick<CommunicationTag, "id" | "name">;

export type CommunicationListItem = {
  id: string;
  title: string;
  ownerName: string;
  status: CommunicationStatus;
  updatedAt: string;
  tags: CommunicationListTag[];
  customer?: Pick<CommunicationCustomer, "id" | "companyName"> | null;
  canViewCustomer?: boolean;
};

export type Communication = {
  id: string;
  customerId: string;
  customer: CommunicationCustomer | null;
  canViewCustomer: boolean;
  title: string;
  summary: string;
  ownerUserId: string;
  ownerName: string;
  status: CommunicationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  tags: CommunicationTag[];
};

type PageQuery = { search?: string; page?: number; pageSize?: number };
type PageResult = { page: number; pageSize: number; total: number };

export type CommunicationListQuery = PageQuery & {
  customerId?: string;
  ownerUserId?: string;
  tagId?: string;
  status?: CommunicationStatus;
};

export type CommunicationWriteInput = {
  title?: string;
  summary?: string;
  ownerUserId?: string;
  status?: CommunicationStatus;
  tagIds?: string[];
};

export class CommunicationApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly current?: unknown
  ) {
    super(message);
    this.name = "CommunicationApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/communications${path}`, options);
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new CommunicationApiError(
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

/** 校验冲突响应中的记录 ID、版本及表单需要读取的字段。 */
export function isCommunicationSnapshot(
  value: unknown,
  id: string
): value is Communication {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<Communication>;
  return (
    record.id === id &&
    typeof record.version === "number" &&
    Number.isInteger(record.version) &&
    record.version > 0 &&
    typeof record.canViewCustomer === "boolean" &&
    typeof record.status === "string" &&
    Object.hasOwn(communicationStatusLabels, record.status) &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.ownerUserId === "string" &&
    typeof record.ownerName === "string" &&
    typeof record.customerId === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.tags)
  );
}

/** 查询当前可见的沟通列表。指定客户 ID 时用于客户详情页签。 */
export function listCommunications(
  query: CommunicationListQuery = {},
  signal?: AbortSignal
) {
  return request<PageResult & { communications: CommunicationListItem[] }>(
    queryString(query),
    { signal }
  );
}

export function getCommunication(id: string, signal?: AbortSignal) {
  return request<{ communication: Communication }>(
    `/${encodeURIComponent(id)}`,
    { signal }
  );
}

export type CreateCommunicationInput = Omit<
  CommunicationWriteInput,
  "status"
> & {
  customerId: string;
  title: string;
  summary: string;
};

export function createCommunication(
  input: CreateCommunicationInput,
  submissionId: string,
  accountId: string
) {
  return request<{ communication: Communication }>("", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submissionId,
      "X-Expected-Account-Id": accountId,
    },
    body: JSON.stringify(input),
  });
}

/** 按最新已查看的版本提交改动。冲突错误的 `current` 包含服务端快照。 */
export function updateCommunication(
  id: string,
  input: CommunicationWriteInput & { expectedVersion: number }
) {
  return write<{ communication: Communication }>(
    `/${encodeURIComponent(id)}`,
    "PATCH",
    input
  );
}

export function listCommunicationOwners(signal?: AbortSignal) {
  return request<{ owners: { id: string; name: string }[] }>("/owners", {
    signal,
  });
}

export function listCommunicationTags(
  query: PageQuery = {},
  signal?: AbortSignal
) {
  return request<PageResult & { tags: CommunicationTag[] }>(
    `/tags${queryString(query)}`,
    { signal }
  );
}

export function getCommunicationTag(id: string, signal?: AbortSignal) {
  return request<{ tag: CommunicationTag }>(`/tags/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function createCommunicationTag(input: {
  name: string;
  color?: string;
}) {
  return write<{ tag: CommunicationTag }>("/tags", "POST", input);
}
