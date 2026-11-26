import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";

import { failVersionConflict } from "../../../errors";
import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { fail } from "../../../errors";
import { lockProductPayoutSource } from "../../product";
import { calculatePayoutMetrics } from "../domain/payout-calculations";
import {
  archivePayoutRow,
  findPayoutProductId,
  hasConflictingPayoutName,
  insertPayout,
  lockPayoutCreateRequest,
  lockPayoutRow,
  selectPayoutDetail,
  selectPayoutPage,
  updatePayoutRow,
} from "../persistence/payouts";
import type {
  PayoutCreateInput,
  PayoutFilters,
  PayoutPatch,
  PayoutRow,
  PayoutSource,
} from "../persistence/payouts";

import { assertPayoutTicketCapacity, failPayoutConflict } from "./errors";

const payoutNotFound = "Payout 不存在。";

function payoutSummary(row: PayoutRow, source: PayoutSource) {
  const { id, productNo, name, customerId, customerNo, companyName } = source;
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    ticketCount: row.ticketCount,
    currencyCode: row.currencyCode,
    unitPrice: row.unitPrice,
    remark: row.remark,
    status: row.status,
    version: row.version,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    product: { id, productNo, name },
    customer: { id: customerId, customerNo, companyName },
    metrics: calculatePayoutMetrics(row),
  };
}

/** 生成详情和写入响应共用的 Payout 视图。 */
function payoutView(row: PayoutRow, source: PayoutSource) {
  return { ...payoutSummary(row, source), definition: row.definition };
}

async function writePayout<T>(
  db: Database,
  write: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(write);
    } catch (error) {
      if (
        isConstraintError(error, "23505", "payout_product_active_name_unique")
      ) {
        failPayoutConflict("payout_name_conflict");
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
      if (attempt >= 3) fail(409, "Payout 有并发更新，请重试。");
    }
  }
}

async function lockPayoutForWrite(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  id: string,
  operation: "replay" | "update" | "archive"
) {
  const productId = await findPayoutProductId(tx, id);
  if (!productId) fail(404, payoutNotFound);

  const archiving = operation === "archive";
  const source = await lockProductPayoutSource(tx, access, productId, {
    includeArchived: archiving,
  });
  if (!source) fail(404, payoutNotFound);
  const record = await lockPayoutRow(
    tx,
    id,
    source.id,
    operation === "replay" ? "share" : "update"
  );
  if (!record || (!archiving && record.status !== "active")) {
    fail(404, payoutNotFound);
  }
  return { record, source };
}

export function createPayoutUseCases(db: Database) {
  return {
    /** 使用同一只读快照读取权限、列表及总数。 */
    listPayouts(access: AccountRecordAccess, filters: PayoutFilters) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          const { rows, total, page, pageSize } = await selectPayoutPage(
            tx,
            freshAccess,
            filters
          );
          return {
            payouts: rows.map((row) => payoutSummary(row.payout, row.source)),
            total,
            page,
            pageSize,
          };
        },
        db
      );
    },
    /** 详情权限随产品关联客户变更，归档或不可见时返回 404。 */
    getPayout(access: AccountRecordAccess, id: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, freshAccess) => {
          const row = await selectPayoutDetail(tx, freshAccess, id);
          if (!row) fail(404, payoutNotFound);
          return payoutView(row.payout, row.source);
        },
        db
      );
    },

    /** 同一账号用同一提交 ID 重试，只会得到第一次保存的记录。 */
    createPayout(
      access: AccountRecordAccess,
      input: PayoutCreateInput,
      requestId: string
    ) {
      // 保留已有的新建请求指纹格式，发布前发出的提交仍可重试。
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ kind: "create", input }))
        .digest("hex");
      return writePayout(db, async (tx) => {
        const existingId = await lockPayoutCreateRequest(
          tx,
          access.userId,
          requestId
        );
        if (existingId) {
          const { record, source } = await lockPayoutForWrite(
            tx,
            access,
            existingId,
            "replay"
          );
          if (record.creationRequestHash !== requestHash) {
            failPayoutConflict("idempotency_conflict");
          }
          return payoutView(record, source);
        }

        const source = await lockProductPayoutSource(
          tx,
          access,
          input.productId
        );
        if (!source) fail(404, "产品不存在。");
        const record = await insertPayout(tx, input, {
          currencyCode: source.currencyCode,
          userId: access.userId,
          requestId,
          requestHash,
        });
        return payoutView(record, source);
      });
    },

    updatePayout(
      access: AccountRecordAccess,
      id: string,
      input: PayoutPatch,
      expectedVersion: number
    ) {
      return writePayout(db, async (tx) => {
        const { record, source } = await lockPayoutForWrite(
          tx,
          access,
          id,
          "update"
        );
        if (record.version !== expectedVersion)
          failVersionConflict(payoutView(record, source));
        if (input.definition !== undefined) {
          assertPayoutTicketCapacity(input.definition, record.ticketCount);
        }

        const { name } = input;
        const nameChanged = name !== undefined && name !== record.name;
        // 只读查重可以提前拦截互换名称，由唯一索引兜底并发写入。
        if (
          nameChanged &&
          (await hasConflictingPayoutName(tx, record.productId, id, name))
        ) {
          failPayoutConflict("payout_name_conflict");
        }

        const changed =
          nameChanged ||
          (input.unitPrice !== undefined &&
            Number(input.unitPrice) !== Number(record.unitPrice)) ||
          (input.remark !== undefined && input.remark !== record.remark) ||
          (input.definition !== undefined &&
            !isDeepStrictEqual(input.definition, record.definition));
        if (!changed) return payoutView(record, source);

        const updated = await updatePayoutRow(tx, id, access.userId, input);
        return payoutView(updated, source);
      });
    },

    archivePayout(
      access: AccountRecordAccess,
      id: string,
      expectedVersion: number
    ) {
      return writePayout(db, async (tx) => {
        const { record, source } = await lockPayoutForWrite(
          tx,
          access,
          id,
          "archive"
        );
        if (record.status === "archived") {
          if (record.version !== expectedVersion + 1) fail(404, payoutNotFound);
          return payoutView(record, source);
        }
        if (record.version !== expectedVersion)
          failVersionConflict(payoutView(record, source));

        const archived = await archivePayoutRow(tx, id, access.userId);
        return payoutView(archived, source);
      });
    },
  };
}
