import type { PayoutDefinition } from "@repo/db/schema";
import { HTTPException } from "hono/http-exception";

import { fail } from "../../../errors";
import { countWinningTickets } from "../domain/payout-calculations";

/** 基于当前发行张数检查奖项定义。 */
export function assertPayoutTicketCapacity(
  definition: PayoutDefinition,
  ticketCount: number
) {
  const winning = countWinningTickets(definition);
  if (winning > ticketCount) {
    fail(400, `中奖张数合计 ${winning}，不能超过总张数 ${ticketCount}。`);
  }
}

const payoutConflictMessages = {
  payout_name_conflict: "该产品已有同名的有效 Payout。",
  idempotency_conflict: "该提交 ID 已用于不同的 Payout 资料。",
} as const;

export function failPayoutConflict(
  code: keyof typeof payoutConflictMessages
): never {
  throw new HTTPException(409, {
    res: Response.json(
      { code, message: payoutConflictMessages[code] },
      { status: 409 }
    ),
  });
}
