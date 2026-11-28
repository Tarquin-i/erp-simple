import type { ModuleErrorResponse } from "../../../errors";
import type { PayoutErrorReason } from "../application/errors";

export const payoutErrorResponses = {
  "not-found": { status: 404 },
  "product-not-found": { status: 404 },
  "name-conflict": { status: 409, code: "payout_name_conflict" },
  "idempotency-conflict": { status: 409, code: "idempotency_conflict" },
  "version-conflict": { status: 409, code: "version_conflict" },
  "concurrent-update": { status: 409 },
  "ticket-capacity": { status: 400 },
} satisfies Record<PayoutErrorReason, ModuleErrorResponse>;
