import type {
  ListOptionOperator,
  ListOptionValue,
} from "@/lib/list-option-query";

export interface PayoutPrize {
  id: string;
  name: string;
  amount: number;
  quantity: number;
}

export interface PayoutPrizeGroup {
  id: string;
  name: string;
  prizes: PayoutPrize[];
}

export interface PayoutDefinition {
  groups: PayoutPrizeGroup[];
}

export interface PayoutMetrics {
  winningTicketCount: number;
  losingTicketCount: number;
  salesAmount: string;
  payoutAmount: string;
  profitAmount: string | null;
  paybackPercent: string | null;
}

export interface PayoutListItem {
  id: string;
  name: string;
  productId: string;
  product: { id: string; productNo: string; name: string };
  customer: { id: string; customerNo: string; companyName: string };
  currencyCode: string;
  unitPrice: string;
  ticketCount: number;
  metrics: PayoutMetrics;
  remark: string;
  status: "active" | "archived";
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutDetailRecord extends PayoutListItem {
  definition: PayoutDefinition;
}

export type PayoutListQuery = {
  productId?: ListOptionValue;
  productOperator?: ListOptionOperator;
  page?: number;
  pageSize?: number;
};

type PayoutPage = {
  payouts: PayoutListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type PayoutCreateInput = {
  productId: string;
  ticketCount: number;
  name: string;
  unitPrice?: string;
  remark?: string;
};

export type PayoutPatch = Partial<
  Pick<PayoutDetailRecord, "name" | "unitPrice" | "remark" | "definition">
>;

type PayoutResponse = { payout: PayoutDetailRecord };

export class PayoutApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly current?: unknown
  ) {
    super(message);
    this.name = "PayoutApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/payouts${path}`, {
    cache: "no-store",
    ...options,
  });
  if (response.ok) return (await response.json()) as T;

  const body = await response.json().catch(() => null);
  throw new PayoutApiError(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
    response.status,
    typeof body?.code === "string" ? body.code : undefined,
    body?.current
  );
}

/** 版本冲突时，仅接受属于当前 Payout 的有效快照。 */
export function isPayoutSnapshot(
  value: unknown,
  id: string
): value is PayoutDetailRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<PayoutDetailRecord>;
  return (
    record.id === id &&
    record.status === "active" &&
    typeof record.version === "number" &&
    Number.isSafeInteger(record.version) &&
    record.version > 0 &&
    typeof record.name === "string" &&
    typeof record.remark === "string" &&
    typeof record.unitPrice === "string" &&
    typeof record.ticketCount === "number" &&
    record.product != null &&
    record.product.id === record.productId &&
    record.customer != null &&
    record.metrics != null &&
    Array.isArray(record.definition?.groups)
  );
}

export function listPayouts(query: PayoutListQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [field, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(field, item);
    } else if (value !== undefined) {
      params.set(field, String(value));
    }
  }
  return request<PayoutPage>(params.size ? `?${params}` : "", { signal });
}

export function getPayout(id: string, signal?: AbortSignal) {
  return request<PayoutResponse>(`/${encodeURIComponent(id)}`, { signal });
}

export function createPayout(input: PayoutCreateInput, submissionId: string) {
  return request<PayoutResponse>("", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submissionId,
    },
    body: JSON.stringify(input),
  });
}

export function updatePayout(
  id: string,
  expectedVersion: number,
  patch: PayoutPatch
) {
  return request<PayoutResponse>(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, expectedVersion }),
  });
}

export function archivePayout(id: string, expectedVersion: number) {
  return request<PayoutResponse>(
    `/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`,
    { method: "DELETE" }
  );
}
