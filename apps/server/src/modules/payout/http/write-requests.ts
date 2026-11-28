import type { PayoutDefinition } from "@repo/db/schema";

import { readString, readUuid } from "../../../http/request-input";
import { fail } from "../../../errors";
import {
  normalizePayoutDecimal,
  PayoutSaleFieldError,
  readPayoutName,
  readPayoutRemark,
  readPayoutSaleFields,
  readPayoutTicketQuantity,
  readPayoutUnitPrice,
} from "../domain/sale-fields";
import type { PayoutCreateInput, PayoutPatch } from "../persistence/payouts";

const maxPrizeTextLength = 128;
const maxGroupCount = 1000;
const maxPrizeCount = 10_000;
const maxExactCents = BigInt(Number.MAX_SAFE_INTEGER);

export const payoutCreateFields = [
  "productId",
  "name",
  "ticketCount",
  "unitPrice",
  "remark",
] as const;

export const payoutPatchFields = [
  "name",
  "unitPrice",
  "remark",
  "definition",
] as const;

function readPrizeAmount(value: unknown) {
  const decimal = normalizePayoutDecimal(value, /^(\d+)(?:\.(\d{1,2}))?$/u);
  if (!decimal) fail(400, "请输入有效的单张奖金，最多保留 2 位小数。");
  const { whole, fraction, text } = decimal;
  const amount = Number(text);
  if (
    amount <= 0 ||
    String(amount) !== text ||
    BigInt(`${whole}${fraction.padEnd(2, "0")}`) > maxExactCents
  ) {
    fail(400, "单张奖金必须大于 0 且能精确保存到分。");
  }
  return amount;
}

function readNestedObject(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, `${label}格式不正确。`);
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    fail(400, `${label}包含不支持的字段。`);
  }
  return value as Record<string, unknown>;
}

function readUniqueText(value: unknown, label: string, seen: Set<string>) {
  const text = readString(value, label, maxPrizeTextLength);
  // PostgreSQL JSONB 拒绝未配对的 UTF-16 代理字符。
  if (/[\uD800-\uDFFF]/u.test(text)) fail(400, `${label}包含无效字符。`);
  const normalized = text.toLowerCase();
  if (seen.has(normalized)) fail(400, `${label}不能重复。`);
  seen.add(normalized);
  return text;
}

function readPayoutDefinition(value: unknown): PayoutDefinition {
  const { groups } = readNestedObject(value, ["groups"], "奖项定义");
  if (!Array.isArray(groups) || groups.length > maxGroupCount) {
    fail(400, `奖项组须为数组，最多可提交 ${maxGroupCount} 组。`);
  }

  const groupIds = new Set<string>();
  const groupNames = new Set<string>();
  const prizeIds = new Set<string>();
  const prizeNames = new Set<string>();
  let prizeCount = 0;

  return {
    groups: groups.map((value) => {
      const group = readNestedObject(value, ["id", "name", "prizes"], "奖项组");
      if (!Array.isArray(group.prizes) || group.prizes.length === 0) {
        fail(400, "每个奖项组至少需要一个奖项。");
      }
      prizeCount += group.prizes.length;
      if (prizeCount > maxPrizeCount) {
        fail(400, `最多可提交 ${maxPrizeCount} 条奖项。`);
      }

      return {
        id: readUniqueText(group.id, "奖项组 ID", groupIds),
        name: readUniqueText(group.name, "奖项组名称", groupNames),
        prizes: group.prizes.map((value) => {
          const prize = readNestedObject(
            value,
            ["id", "name", "amount", "quantity"],
            "奖项"
          );
          return {
            id: readUniqueText(prize.id, "奖项 ID", prizeIds),
            name: readUniqueText(prize.name, "奖项名称", prizeNames),
            amount: readPrizeAmount(prize.amount),
            quantity: readPayoutTicketQuantity(prize.quantity, "中奖张数"),
          };
        }),
      };
    }),
  };
}

function readSaleFieldsForRequest<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof PayoutSaleFieldError) fail(400, error.message);
    throw error;
  }
}

/** 做好金额和名称规范化，再生成新建请求指纹。 */
export function readPayoutCreateInput(
  body: Record<string, unknown>
): PayoutCreateInput {
  return {
    productId: readUuid(body.productId, "产品 ID"),
    ...readSaleFieldsForRequest(() => readPayoutSaleFields(body)),
  };
}

export function readPayoutPatch(body: Record<string, unknown>): PayoutPatch {
  return readSaleFieldsForRequest(() => {
    const patch: PayoutPatch = {};
    if (Object.hasOwn(body, "name")) patch.name = readPayoutName(body.name);
    if (Object.hasOwn(body, "unitPrice"))
      patch.unitPrice = readPayoutUnitPrice(body.unitPrice);
    if (Object.hasOwn(body, "remark"))
      patch.remark = readPayoutRemark(body.remark);
    if (Object.hasOwn(body, "definition")) {
      patch.definition = readPayoutDefinition(body.definition);
    }
    if (!Object.keys(patch).length) fail(400, "请提交需要更新的 Payout 资料。");
    return patch;
  });
}
