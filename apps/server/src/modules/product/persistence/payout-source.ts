import type { DatabaseTransaction } from "@repo/db";
import { product } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import type { AccountRecordAccess } from "../../organization";
import { lockCustomerForWrite } from "../../customer";
import { ModuleError } from "../../shared/application-error";
import { findProductCustomerId } from "./products";

/** 在调用方的事务中复核客户权限，再共享锁定产品供 Payout 使用。 */
export async function lockProductPayoutSource(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  productId: string,
  { includeArchived = false } = {}
) {
  const customerId = await findProductCustomerId(tx, access, productId, false);
  if (!customerId) return null;

  const lockedCustomer = await lockCustomerForWrite(
    tx,
    access,
    customerId,
    "share",
    includeArchived
  ).catch((error: unknown) => {
    if (
      (error instanceof ModuleError &&
        ((error.module === "customer" &&
          error.reason === "profileWriteNotFound") ||
          (error.module === "organization" &&
            error.reason === "departmentNotFound"))) ||
      (error instanceof HTTPException && error.status === 404)
    ) {
      return null;
    }
    throw error;
  });
  if (!lockedCustomer) return null;

  const { record: owner } = lockedCustomer;
  const [source] = await tx
    .select({
      id: product.id,
      productNo: product.productNo,
      name: product.name,
      status: product.status,
      currencyCode: product.currencyCode,
    })
    .from(product)
    .where(and(eq(product.id, productId), eq(product.customerId, owner.id)))
    .for("share");
  if (!source || (!includeArchived && source.status !== "active")) return null;

  const { id, productNo, name, currencyCode } = source;
  return {
    id,
    productNo,
    name,
    currencyCode,
    customerId: owner.id,
    customerNo: owner.customerNo,
    companyName: owner.companyName,
  };
}
