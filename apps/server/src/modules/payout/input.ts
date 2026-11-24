import type { PayoutDefinition } from "@repo/db/schema";

import { readString, readUuid } from "../customer/input";
import { fail } from "../organization/errors";

export const maxPayoutNameLength = 128;
const maxRemarkLength = 2000;
const maxTicketCount = 1_000_000;
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

export const payoutCopyFields = ["name", "ticketCount"] as const;

export interface PayoutCreateInput {
  productId: string;
  name: string;
  ticketCount: number;
  unitPrice: string;
  remark: string;
}

export interface PayoutPatch {
  name?: string;
  unitPrice?: string;
  remark?: string;
  definition?: PayoutDefinition;
}

export interface PayoutCopyInput {
  name?: string;
  ticketCount: number;
}

function readOptionalName(value: unknown) {
  if (value === undefined || (typeof value === "string" && !value.trim())) {
    return undefined;
  }
  return readString(value, "Payout 名称", maxPayoutNameLength);
}

function readTicketQuantity(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxTicketCount
  ) {
    fail(400, `${label}须为 1 至 ${maxTicketCount} 的整数。`);
  }
  return value;
}

function readRemark(value: unknown) {
  if (typeof value !== "string") fail(400, "Payout 备注须为文本。");
  const remark = value.trim();
  if (remark.length > maxRemarkLength || remark.includes("\0")) {
    fail(400, `请检查 Payout 备注，最多可填写 ${maxRemarkLength} 个字符。`);
  }
  return remark;
}

function readDecimal(value: unknown, pattern: RegExp, invalidMessage: string) {
  const text =
    typeof value === "number" || typeof value === "string"
      ? String(value).trim()
      : "";
  const parts = pattern.exec(text);
  if (!parts?.[1]) fail(400, invalidMessage);

  // 统一提交指纹中的金额表示，也便于检查写入 JSONB 的数值精度。
  const whole = parts[1].replace(/^0+(?=\d)/u, "");
  const fraction = parts[2]?.replace(/0+$/u, "") ?? "";
  return { whole, fraction, text: fraction ? `${whole}.${fraction}` : whole };
}

function readUnitPrice(value: unknown) {
  const { text } = readDecimal(
    value,
    /^(\d+)(?:\.(\d{1,4}))?$/u,
    "请输入有效的每张售价，最多保留 4 位小数。"
  );
  const price = Number(text);
  if (price <= 0 || price > 100_000) {
    fail(400, "每张售价必须大于 0 且不超过 100000。");
  }
  return text;
}

function readPrizeAmount(value: unknown) {
  const { whole, fraction, text } = readDecimal(
    value,
    /^(\d+)(?:\.(\d{1,2}))?$/u,
    "请输入有效的单张奖金，最多保留 2 位小数。"
  );
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
  const text = readString(value, label, maxPayoutNameLength);
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
            quantity: readTicketQuantity(prize.quantity, "中奖张数"),
          };
        }),
      };
    }),
  };
}

/** 做好金额和名称规范化，再生成新建请求指纹。 */
export function readPayoutCreateInput(
  body: Record<string, unknown>
): PayoutCreateInput {
  return {
    productId: readUuid(body.productId, "产品 ID"),
    name: readString(body.name, "Payout 名称", maxPayoutNameLength),
    ticketCount: readTicketQuantity(body.ticketCount, "总张数"),
    unitPrice:
      body.unitPrice === undefined ? "1" : readUnitPrice(body.unitPrice),
    remark: body.remark === undefined ? "" : readRemark(body.remark),
  };
}

export function readPayoutPatch(body: Record<string, unknown>): PayoutPatch {
  const patch: PayoutPatch = {};
  if (Object.hasOwn(body, "name")) {
    patch.name = readString(body.name, "Payout 名称", maxPayoutNameLength);
  }
  if (Object.hasOwn(body, "unitPrice"))
    patch.unitPrice = readUnitPrice(body.unitPrice);
  if (Object.hasOwn(body, "remark")) patch.remark = readRemark(body.remark);
  if (Object.hasOwn(body, "definition")) {
    patch.definition = readPayoutDefinition(body.definition);
  }
  if (!Object.keys(patch).length) fail(400, "请提交需要更新的 Payout 资料。");
  return patch;
}

export function readPayoutCopyInput(
  body: Record<string, unknown>
): PayoutCopyInput {
  return {
    name: readOptionalName(body.name),
    ticketCount: readTicketQuantity(body.ticketCount, "总张数"),
  };
}

/** 基于当前发行张数检查奖项定义，也用于检查副本的新发行张数。 */
export function assertPayoutTicketCapacity(
  definition: PayoutDefinition,
  ticketCount: number
) {
  const winning = definition.groups.reduce(
    (total, group) =>
      group.prizes.reduce((sum, prize) => sum + prize.quantity, total),
    0
  );
  if (winning > ticketCount) {
    fail(400, `中奖张数合计 ${winning}，不能超过总张数 ${ticketCount}。`);
  }
}
