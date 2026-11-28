import type { ErrorHandler } from "hono";

import type { RecordAccessEnv } from "../../identity";
import { PayoutApplicationError } from "../application/errors";

const payoutErrorResponses: Record<
  PayoutApplicationError["reason"],
  { status: 400 | 404 | 409; code?: string }
> = {
  "not-found": { status: 404 },
  "product-not-found": { status: 404 },
  "name-conflict": { status: 409, code: "payout_name_conflict" },
  "idempotency-conflict": { status: 409, code: "idempotency_conflict" },
  "version-conflict": { status: 409, code: "version_conflict" },
  "concurrent-update": { status: 409 },
  "ticket-capacity": { status: 400 },
};

export const handlePayoutError: ErrorHandler<RecordAccessEnv> = (
  error,
  context
) => {
  if (!(error instanceof PayoutApplicationError)) throw error;

  const { status, code } = payoutErrorResponses[error.reason];
  // 沿用原错误响应的 JSON 类型和字符集。
  const response = Response.json(
    { code, message: error.message, current: error.current },
    { status }
  );
  return context.newResponse(response.body, response);
};
