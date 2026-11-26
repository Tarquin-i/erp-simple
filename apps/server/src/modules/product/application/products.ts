import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";

import { failVersionConflict } from "../../../errors";
import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { lockCustomerForWrite } from "../../customer";
import { fail } from "../../../errors";
import { resolveProductPatch } from "../domain/type-fields";
import type { ProductCreateInput, ProductPatch } from "../domain/type-fields";
import {
  archiveProductRow,
  findProductCustomerId,
  hasActiveProductPayout,
  insertProduct,
  lockProductCreateRequest,
  lockProductRow,
  productView,
  selectProductDetail,
  selectProductPage,
  updateProductRow,
} from "../persistence/products";
import type { ProductFilters } from "../persistence/products";
import {
  failInvalidProductTypeFields,
  failProductConflict,
  failProductNotFound,
} from "./errors";

const nameConstraints = [
  ["product_customer_active_name_unique", "product_name_conflict"],
  [
    "product_customer_active_english_name_unique",
    "product_english_name_conflict",
  ],
] as const;

/** 由唯一索引兜底名称查重，撞编号或死锁时重新执行完整事务。 */
async function writeProduct<T>(
  db: Database,
  write: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(write);
    } catch (error) {
      const nameConflict = nameConstraints.find(([constraint]) =>
        isConstraintError(error, "23505", constraint)
      );
      if (nameConflict) failProductConflict(nameConflict[1]);
      if (isConstraintError(error, "23505", "product_product_no_unique")) {
        if (attempt >= 5) fail(409, "产品编号生成冲突，请重试。");
        continue;
      }
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "40P01"
      ) {
        throw error;
      }
      if (attempt >= 3) fail(409, "产品有并发更新，请重试。");
    }
  }
}

/** 先锁客户并重新确认可访问范围，再锁产品并核对版本。 */
async function lockProductForWrite(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  expectedVersion: number,
  operation: "update" | "archive"
) {
  const activeOnly = operation === "update";
  const customerId = await findProductCustomerId(tx, access, id, activeOnly);
  if (!customerId) failProductNotFound();

  const { record: owner } = await lockCustomerForWrite(
    tx,
    access,
    customerId,
    "share",
    operation === "archive"
  );
  const current = await lockProductRow(tx, id, owner.id, {
    mode: "update",
    activeOnly,
  });
  if (
    !current ||
    (owner.status === "archived" && current.status === "active")
  ) {
    failProductNotFound();
  }
  if (current.status === "archived") {
    if (current.version !== expectedVersion + 1) failProductNotFound();
  } else if (current.version !== expectedVersion) {
    failVersionConflict(productView(current, owner));
  }
  return { current, owner };
}

export function createProductUseCases(db: Database) {
  return {
    /** 在同一个只读快照中按客户权限查询有效产品和总条数。 */
    listProducts(access: AccountRecordAccess, filters: ProductFilters) {
      return withRecordReadSnapshot(
        access.userId,
        (tx, freshAccess) => selectProductPage(tx, freshAccess, filters),
        db
      );
    },
    /** 产品详情的可见范围跟随当前所属客户。 */
    getProduct(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          const row = await selectProductDetail(tx, freshAccess, id);
          if (!row) failProductNotFound();
          return productView(row.product, row.customer);
        },
        db
      );
    },
    /** 同一账号重复提交同一份资料时，读取原产品并再次核对客户权限。 */
    createProduct(
      access: AccountRecordAccess,
      input: ProductCreateInput,
      requestId: string
    ) {
      const requestHash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      return writeProduct(db, async (tx) => {
        const existing = await lockProductCreateRequest(
          tx,
          access.userId,
          requestId
        );
        const { record: owner } = await lockCustomerForWrite(
          tx,
          access,
          existing?.customerId ?? input.customerId,
          "share"
        );
        if (existing) {
          const saved = await lockProductRow(tx, existing.id, owner.id, {
            mode: "share",
            activeOnly: true,
          });
          if (!saved) failProductNotFound();
          if (saved.creationRequestHash !== requestHash) {
            failProductConflict("idempotency_conflict");
          }
          return productView(saved, owner);
        }

        const created = await insertProduct(tx, input, {
          userId: access.userId,
          requestId,
          requestHash,
        });
        return productView(created, owner);
      });
    },
    /** 合并并校验修改，只有实际字段变更才增加版本。 */
    updateProduct(
      access: AccountRecordAccess,
      id: string,
      input: ProductPatch,
      expectedVersion: number
    ) {
      return writeProduct(db, async (tx) => {
        const { current, owner } = await lockProductForWrite(
          tx,
          access,
          id,
          expectedVersion,
          "update"
        );
        const resolved = resolveProductPatch(current, input);
        if (!resolved.ok) failInvalidProductTypeFields(resolved.reason);
        const changes = resolved.fields;
        const changed = (Object.keys(changes) as (keyof ProductPatch)[]).some(
          (field) => {
            const value = changes[field];
            if (value === undefined) return false;
            // 价格范围和精度已受限，数值比较可忽略存量价格末尾的零。
            return field === "unitPrice"
              ? Number(value) !== Number(current.unitPrice)
              : value !== current[field];
          }
        );
        if (!changed) return productView(current, owner);

        const updated = await updateProductRow(tx, id, changes);
        return productView(updated, owner);
      });
    },
    /** 已完成的归档可按原预期版本重试，直接返回归档结果。 */
    archiveProduct(
      access: AccountRecordAccess,
      id: string,
      expectedVersion: number
    ) {
      return writeProduct(db, async (tx) => {
        const { current, owner } = await lockProductForWrite(
          tx,
          access,
          id,
          expectedVersion,
          "archive"
        );
        if (current.status === "archived") return productView(current, owner);

        // Payout 新建会共享锁定产品。等待它提交后，在当前写锁内核对有效奖表。
        if (await hasActiveProductPayout(tx, id)) {
          failProductConflict("product_payout_conflict");
        }

        const archived = await archiveProductRow(tx, id);
        return productView(archived, owner);
      });
    },
  };
}
