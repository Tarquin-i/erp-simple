export const productTypeLabels = {
  "pull-tab": "揭开卡",
  lottery: "彩票",
  "scratch-card": "刮刮卡",
  "hang-tag": "吊牌",
  "recharge-card": "充值卡",
  "tax-stamp": "税票",
  "user-defined": "自定义",
} as const;

export type ProductType = keyof typeof productTypeLabels;

export type ProductWriteInput = {
  name: string;
  englishName: string;
  productType: ProductType;
  customerDefinedType: string | null;
  specification: string;
  packagingSpecification: string;
  colorCount: string;
  paperType: string;
  finishedSize: string;
  finalMolding: string;
  surfaceTreatment: string;
  variableColor: string;
  variationMethod: string;
  dieCutDirection: string | null;
  peelOffQuantity: number | null;
  scratchOffArea: string | null;
  currencyCode: string;
  unitPrice: string;
  remark: string;
};

export type ProductCreateInput = ProductWriteInput & { customerId: string };

export type ProductListItem = Pick<
  ProductWriteInput,
  | "name"
  | "englishName"
  | "productType"
  | "customerDefinedType"
  | "currencyCode"
  | "unitPrice"
> & {
  id: string;
  productNo: string;
  customerId: string;
  customer: { id: string; customerNo: string; companyName: string };
  status: "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductDetailRecord = ProductListItem &
  ProductWriteInput & { createdByUserId: string };

export type ProductListQuery = {
  search?: string;
  customerId?: string;
  productTypes?: ProductType[];
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ProductPage = {
  products: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
};

type ProductResponse = { product: ProductDetailRecord };

export class ProductApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly current?: unknown
  ) {
    super(message);
    this.name = "ProductApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/products${path}`, {
    cache: "no-store",
    ...options,
  });
  if (response.ok) return (await response.json()) as T;

  const body = await response.json().catch(() => null);
  throw new ProductApiError(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
    response.status,
    typeof body?.code === "string" ? body.code : undefined,
    body?.current
  );
}

export function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && Object.hasOwn(productTypeLabels, value);
}

/** 核对版本冲突返回的快照属于正在操作的有效产品。 */
export function isProductSnapshot(
  value: unknown,
  id: string
): value is ProductDetailRecord {
  if (typeof value !== "object" || value === null) return false;
  const product = value as Partial<ProductDetailRecord>;
  return (
    product.id === id &&
    product.status === "active" &&
    typeof product.version === "number" &&
    Number.isSafeInteger(product.version) &&
    product.version > 0 &&
    product.customer != null &&
    product.customer.id === product.customerId &&
    typeof product.customer.companyName === "string" &&
    typeof product.name === "string" &&
    typeof product.englishName === "string" &&
    typeof product.unitPrice === "string" &&
    isProductType(product.productType)
  );
}

export function listProducts(
  query: ProductListQuery = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  const { productTypes, ...filters } = query;
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(field, String(value));
  }
  for (const type of productTypes ?? []) params.append("productTypes", type);
  return request<ProductPage>(params.size ? `?${params}` : "", { signal });
}

export function getProduct(id: string, signal?: AbortSignal) {
  return request<ProductResponse>(`/${encodeURIComponent(id)}`, { signal });
}

export function createProduct(input: ProductCreateInput, submissionId: string) {
  return request<ProductResponse>("", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submissionId,
    },
    body: JSON.stringify(input),
  });
}

export function updateProduct(
  id: string,
  expectedVersion: number,
  patch: Partial<ProductWriteInput>
) {
  return request<ProductResponse>(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, expectedVersion }),
  });
}

export function archiveProduct(id: string, expectedVersion: number) {
  return request<ProductResponse>(
    `/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`,
    { method: "DELETE" }
  );
}
