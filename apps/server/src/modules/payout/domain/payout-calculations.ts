import type { PayoutDefinition } from "@repo/db/schema";

// 金额入库时已经校验精度。先按十进制文本转整数，再计算和舍入。
function decimalUnits(value: string, decimals: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
}

function formatCents(cents: bigint) {
  const absoluteCents = cents < 0n ? -cents : cents;
  const fraction = (absoluteCents % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${absoluteCents / 100n}.${fraction}`;
}

type PayoutCalculationInput = {
  definition: PayoutDefinition;
  ticketCount: number;
  unitPrice: string;
};

export function countWinningTickets(definition: PayoutDefinition) {
  return definition.groups.reduce(
    (total, group) =>
      group.prizes.reduce((sum, prize) => sum + prize.quantity, total),
    0
  );
}

export function calculatePayoutMetrics({
  definition,
  ticketCount,
  unitPrice,
}: PayoutCalculationInput) {
  const winningTicketCount = countWinningTickets(definition);
  let payoutCents = 0n;
  for (const { prizes } of definition.groups) {
    for (const { amount, quantity } of prizes) {
      payoutCents += decimalUnits(String(amount), 2) * BigInt(quantity);
    }
  }

  const salesUnits = decimalUnits(unitPrice, 4) * BigInt(ticketCount);
  const salesCents = (salesUnits + 50n) / 100n;
  // 和参考奖表一致，用舍入到分的销售额和赔付额计算两位小数的百分比。
  const paybackPercent =
    winningTicketCount > 0 && salesCents > 0n
      ? formatCents((payoutCents * 10_000n + salesCents / 2n) / salesCents)
      : null;

  return {
    winningTicketCount,
    losingTicketCount: ticketCount - winningTicketCount,
    salesAmount: formatCents(salesCents),
    payoutAmount: formatCents(payoutCents),
    profitAmount:
      winningTicketCount > 0 ? formatCents(salesCents - payoutCents) : null,
    paybackPercent,
  };
}
