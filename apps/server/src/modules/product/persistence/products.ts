import { customer, payout, product, productType } from "@repo/db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { businessScopeWhere } from "../../business/access";
import type { BusinessAccess } from "../../business/access";
import type { ListOptionFilter } from "../../business/list-option-filter";
import type { DatabaseTransaction } from "../../identity/auth/better-auth";
import { productTypeLabels } from "../domain/type-fields";
import type {
  ProductCreateInput,
  ProductPatch,
  ProductType,
} from "../domain/type-fields";

type Product = typeof product.$inferSelect;

export interface ProductFilters {
  page: number;
  pageSize: number;
  search?: string;
  customers?: ListOptionFilter;
  productTypes?: ListOptionFilter<ProductType>;
  sortDirection?: "asc" | "desc";
}

const customerFields = {
  id: customer.id,
  customerNo: customer.customerNo,
  companyName: customer.companyName,
};
type ProductCustomer = Pick<
  typeof customer.$inferSelect,
  keyof typeof customerFields
>;

const listFields = {
  id: product.id,
  productNo: product.productNo,
  customerId: product.customerId,
  name: product.name,
  englishName: product.englishName,
  productType: product.productType,
  customerDefinedType: product.customerDefinedType,
  currencyCode: product.currencyCode,
  unitPrice: product.unitPrice,
  status: product.status,
  version: product.version,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
};

function productSearchWhere(search: string) {
  const term = sql`lower(${search}::text collate pg_catalog."und-x-icu")`;
  const matchingTypes = productType.enumValues.filter((type) =>
    productTypeLabels[type].includes(search)
  );
  // 搜索词按字面匹配，百分号和下划线也是普通字符。
  return or(
    sql`position(${term} in lower(${product.productNo})) > 0`,
    sql`position(${term} in ${product.normalizedName}) > 0`,
    sql`position(${term} in ${product.normalizedEnglishName}) > 0`,
    sql`position(${term} in ${product.productType}::text) > 0`,
    sql`position(${term} in ${product.normalizedCustomerDefinedType}) > 0`,
    sql`position(${term} in lower(${customer.companyName} collate pg_catalog."und-x-icu")) > 0`,
    sql`position(${term} in lower(${customer.customerNo})) > 0`,
    matchingTypes.length
      ? inArray(product.productType, matchingTypes)
      : undefined
  );
}

/** 生成详情和写入响应共用的产品视图。 */
export function productView(
  row: Product,
  { id, customerNo, companyName }: ProductCustomer
) {
  const {
    normalizedName,
    normalizedEnglishName,
    normalizedCustomerDefinedType,
    creationRequestId,
    creationRequestHash,
    ...detail
  } = row;
  return { ...detail, customer: { id, customerNo, companyName } };
}

export async function selectProductPage(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  filters: ProductFilters
) {
  const { page, pageSize, search, customers, productTypes, sortDirection } =
    filters;
  const order = sortDirection === "asc" ? asc : desc;
  const customerMatches = customers?.excluded ? notInArray : inArray;
  const typeMatches = productTypes?.excluded ? notInArray : inArray;
  const filter = and(
    businessScopeWhere(access, customer),
    eq(product.status, "active"),
    customers
      ? customerMatches(product.customerId, customers.values)
      : undefined,
    productTypes
      ? typeMatches(product.productType, productTypes.values)
      : undefined,
    search === undefined ? undefined : productSearchWhere(search)
  );
  const products = await tx
    .select({ ...listFields, customer: customerFields })
    .from(product)
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(filter)
    .orderBy(order(product.createdAt), order(product.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await tx
    .select({ count: count() })
    .from(product)
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(filter);
  return { products, total: total.count, page, pageSize };
}

export async function selectProductDetail(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string
) {
  const [row] = await tx
    .select({ product, customer: customerFields })
    .from(product)
    .innerJoin(customer, eq(customer.id, product.customerId))
    .where(
      and(
        eq(product.id, id),
        eq(product.status, "active"),
        businessScopeWhere(access, customer)
      )
    );
  return row;
}

export async function findProductCustomerId(
  tx: DatabaseTransaction,
  access: BusinessAccess,
  id: string,
  activeOnly: boolean
) {
  const [target] = await tx
    .select({ customerId: product.customerId })
    .from(product)
    .innerJoin(customer, eq(product.customerId, customer.id))
    .where(
      and(
        eq(product.id, id),
        activeOnly ? eq(product.status, "active") : undefined,
        businessScopeWhere(access, customer)
      )
    );
  return target?.customerId;
}

export async function lockProductRow(
  tx: DatabaseTransaction,
  id: string,
  customerId: string,
  { mode, activeOnly }: { mode: "share" | "update"; activeOnly: boolean }
) {
  const [row] = await tx
    .select()
    .from(product)
    .where(
      and(
        eq(product.id, id),
        eq(product.customerId, customerId),
        activeOnly ? eq(product.status, "active") : undefined
      )
    )
    .for(mode);
  return row;
}

export async function lockProductCreateRequest(
  tx: DatabaseTransaction,
  userId: string,
  requestId: string
) {
  const lockKey = JSON.stringify(["product-create", userId, requestId]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  );
  const [existing] = await tx
    .select({ id: product.id, customerId: product.customerId })
    .from(product)
    .where(
      and(
        eq(product.createdByUserId, userId),
        eq(product.creationRequestId, requestId)
      )
    );
  return existing;
}

export async function insertProduct(
  tx: DatabaseTransaction,
  input: ProductCreateInput,
  {
    userId,
    requestId,
    requestHash,
  }: {
    userId: string;
    requestId: string;
    requestHash: string;
  }
) {
  const [created] = await tx
    .insert(product)
    .values({
      ...input,
      createdByUserId: userId,
      creationRequestId: requestId,
      creationRequestHash: requestHash,
    })
    .returning();
  return created;
}

const revision = {
  version: sql`${product.version} + 1`,
  updatedAt: sql`clock_timestamp()`,
};

export async function updateProductRow(
  tx: DatabaseTransaction,
  id: string,
  changes: ProductPatch
) {
  const [updated] = await tx
    .update(product)
    .set({ ...changes, ...revision })
    .where(eq(product.id, id))
    .returning();
  return updated;
}

export async function hasActiveProductPayout(
  tx: DatabaseTransaction,
  id: string
) {
  const [activePayout] = await tx
    .select({ id: payout.id })
    .from(payout)
    .where(and(eq(payout.productId, id), eq(payout.status, "active")))
    .limit(1);
  return Boolean(activePayout);
}

export async function archiveProductRow(tx: DatabaseTransaction, id: string) {
  const [archived] = await tx
    .update(product)
    .set({ status: "archived", ...revision })
    .where(eq(product.id, id))
    .returning();
  return archived;
}
