import type { PayoutDefinition, PayoutMetrics } from "@/request/payouts";

function decimalUnits(value: string, decimals: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
}

function fromCents(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${fraction}`;
}

/** 详情草稿的试算采用服务端相同的十进制精度及舍入顺序。 */
export function calculatePayoutMetrics(
  definition: PayoutDefinition,
  ticketCount: number,
  unitPrice: string
): PayoutMetrics {
  let winningTicketCount = 0;
  let payoutCents = 0n;
  for (const { prizes } of definition.groups) {
    for (const { amount, quantity } of prizes) {
      winningTicketCount += quantity;
      payoutCents += decimalUnits(String(amount), 2) * BigInt(quantity);
    }
  }

  const salesCents =
    (decimalUnits(unitPrice, 4) * BigInt(ticketCount) + 50n) / 100n;
  return {
    winningTicketCount,
    losingTicketCount: ticketCount - winningTicketCount,
    salesAmount: fromCents(salesCents),
    payoutAmount: fromCents(payoutCents),
    profitAmount:
      winningTicketCount > 0 ? fromCents(salesCents - payoutCents) : null,
    paybackPercent:
      winningTicketCount > 0 && salesCents > 0n
        ? fromCents((payoutCents * 10_000n + salesCents / 2n) / salesCents)
        : null,
  };
}

/** 货币整数字段按 bigint 格式化，保留原字符串的小数和精度。 */
export function formatPayoutMoney(value: string | null, currencyCode: string) {
  if (value === null) return "—";
  const [whole, fraction = ""] = value.split(".");
  const formatter = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
  });
  return formatter
    .formatToParts(whole === "-0" ? -0 : BigInt(whole))
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}

const quantityFormatter = new Intl.NumberFormat("zh-CN");

export function formatPayoutQuantity(value: number) {
  return quantityFormatter.format(value);
}

export function formatPayoutPercent(value: string | null) {
  return value === null ? "—" : `${value}%`;
}
