import { customer, product, productType } from "@repo/db/schema";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import {
  businessScopeWhere,
  withBusinessReadSnapshot,
} from "../business/access";
import type { BusinessAccess } from "../business/access";
import { fail } from "../organization/errors";
import { productTypeLabels } from "./input";
import type { ProductType } from "./input";

type Product = typeof product.$inferSelect;

interface ProductFilters {
  page: number;
  pageSize: number;
  search?: string;
  customerId?: string;
  productTypes?: readonly ProductType[];
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

/** 在同一个只读快照中按客户权限查询有效产品和总条数。 */
export function listProducts(access: BusinessAccess, filters: ProductFilters) {
  const { page, pageSize, search, customerId, productTypes, sortDirection } =
    filters;
  const order = sortDirection === "asc" ? asc : desc;
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    const filter = and(
      businessScopeWhere(freshAccess, customer),
      eq(product.status, "active"),
      customerId === undefined ? undefined : eq(product.customerId, customerId),
      productTypes?.length
        ? inArray(product.productType, productTypes)
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
  });
}

/** 产品详情的可见范围跟随当前所属客户，归档产品返回 404。 */
export function getProduct(access: BusinessAccess, id: string) {
  return withBusinessReadSnapshot(access.userId, async (tx, freshAccess) => {
    const [row] = await tx
      .select({ product, customer: customerFields })
      .from(product)
      .innerJoin(customer, eq(customer.id, product.customerId))
      .where(
        and(
          eq(product.id, id),
          eq(product.status, "active"),
          businessScopeWhere(freshAccess, customer)
        )
      );
    if (!row) fail(404, "产品不存在。");
    return productView(row.product, row.customer);
  });
}
