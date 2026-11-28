import { validateRequiredText } from "../../shared/required-text";

const maxPayoutNameLength = 128;
const maxRemarkLength = 2000;
const maxTicketCount = 1_000_000;

export class PayoutSaleFieldError extends Error {}

export function readPayoutName(value: unknown) {
  const name = validateRequiredText(value, "Payout 名称", maxPayoutNameLength);
  if (!name.ok) throw new PayoutSaleFieldError(name.message);
  return name.value;
}

export function readPayoutTicketQuantity(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxTicketCount
  ) {
    throw new PayoutSaleFieldError(
      `${label}须为 1 至 ${maxTicketCount} 的整数。`
    );
  }
  return value;
}

export function readPayoutRemark(value: unknown) {
  if (typeof value !== "string") {
    throw new PayoutSaleFieldError("Payout 备注须为文本。");
  }
  const remark = value.trim();
  if (remark.length > maxRemarkLength || remark.includes("\0")) {
    throw new PayoutSaleFieldError(
      `请检查 Payout 备注，最多可填写 ${maxRemarkLength} 个字符。`
    );
  }
  return remark;
}

export function normalizePayoutDecimal(value: unknown, pattern: RegExp) {
  const text =
    typeof value === "number" || typeof value === "string"
      ? String(value).trim()
      : "";
  const parts = pattern.exec(text);
  if (!parts?.[1]) return undefined;

  // 保持指纹中的十进制文本稳定，并保留校验奖金精度所需的各部分。
  const whole = parts[1].replace(/^0+(?=\d)/u, "");
  const fraction = parts[2]?.replace(/0+$/u, "") ?? "";
  return { whole, fraction, text: fraction ? `${whole}.${fraction}` : whole };
}

export function readPayoutUnitPrice(value: unknown) {
  const decimal = normalizePayoutDecimal(value, /^(\d+)(?:\.(\d{1,4}))?$/u);
  if (!decimal) {
    throw new PayoutSaleFieldError("请输入有效的每张售价，最多保留 4 位小数。");
  }
  const price = Number(decimal.text);
  if (price <= 0 || price > 100_000) {
    throw new PayoutSaleFieldError("每张售价必须大于 0 且不超过 100000。");
  }
  return decimal.text;
}

/** 按新建指纹的字段顺序返回规范化后的售卖资料。 */
export function readPayoutSaleFields(input: Record<string, unknown>) {
  return {
    name: readPayoutName(input.name),
    ticketCount: readPayoutTicketQuantity(input.ticketCount, "总张数"),
    unitPrice:
      input.unitPrice === undefined
        ? "1"
        : readPayoutUnitPrice(input.unitPrice),
    remark: input.remark === undefined ? "" : readPayoutRemark(input.remark),
  };
}
