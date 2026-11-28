import type { PayoutDefinition } from "@repo/db/schema";

import { ModuleError } from "../../shared/application-error";
import { getPayoutTicketCapacityError } from "../domain/payout-calculations";

const payoutErrorMessages = {
  "not-found": "Payout 不存在。",
  "product-not-found": "产品不存在。",
  "name-conflict": "该产品已有同名的有效 Payout。",
  "idempotency-conflict": "该提交 ID 已用于不同的 Payout 资料。",
  "version-conflict": "资料已被更新，请查看最新资料后确认是否覆盖。",
  "concurrent-update": "Payout 有并发更新，请重试。",
} as const;

export type PayoutErrorReason =
  | keyof typeof payoutErrorMessages
  | "ticket-capacity";

export function failPayout(
  reason: keyof typeof payoutErrorMessages,
  current?: unknown
): never {
  throw new ModuleError("payout", reason, payoutErrorMessages[reason], current);
}

/** 基于当前发行张数检查奖项定义。 */
export function assertPayoutTicketCapacity(
  definition: PayoutDefinition,
  ticketCount: number
) {
  const message = getPayoutTicketCapacityError(definition, ticketCount);
  if (message) throw new ModuleError("payout", "ticket-capacity", message);
}
