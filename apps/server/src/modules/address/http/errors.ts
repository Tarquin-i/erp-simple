import type { BusinessErrorResponse } from "../../../errors";
import type { AddressErrorReason } from "../application/errors";

export const addressErrorResponses = {
  addressNotFound: { status: 404 },
  customerNotFound: { status: 404 },
  invalidPostalCode: { status: 400 },
  countryChangeRequiresCity: { status: 400 },
  provinceChangeRequiresCity: { status: 400 },
  defaultChanged: { status: 409 },
  concurrentWrite: { status: 409 },
  idempotencyConflict: { status: 409, code: "idempotency_conflict" },
  defaultConfirmationRequired: {
    status: 409,
    code: "existing_default_conflict",
  },
  defaultConfirmationStale: { status: 409, code: "existing_default_conflict" },
  defaultUnsetForbidden: { status: 409, code: "default_unset_forbidden" },
  versionConflict: { status: 409, code: "version_conflict" },
} satisfies Record<AddressErrorReason, BusinessErrorResponse>;
