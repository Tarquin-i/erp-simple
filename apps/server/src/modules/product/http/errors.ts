import type { BusinessErrorResponse } from "../../../errors";
import type { ProductErrorReason } from "../application/errors";

export const productErrorResponses = {
  "not-found": { status: 404 },
  "name-conflict": { status: 409, code: "product_name_conflict" },
  "english-name-conflict": {
    status: 409,
    code: "product_english_name_conflict",
  },
  "idempotency-conflict": { status: 409, code: "idempotency_conflict" },
  "payout-conflict": { status: 409, code: "product_payout_conflict" },
  "number-conflict": { status: 409 },
  "concurrent-update": { status: 409 },
  "version-conflict": { status: 409, code: "version_conflict" },
  "invalid-type-fields": { status: 400 },
} satisfies Record<ProductErrorReason, BusinessErrorResponse>;
