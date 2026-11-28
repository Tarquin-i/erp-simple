import type { ModuleErrorResponse } from "../../../errors";
import type { CommunicationErrorReason } from "../application/errors";

export const communicationErrorResponses = {
  writeTargetForbidden: { status: 403 },
  tagsNotAssignable: { status: 400 },
  assignedTagNotFound: { status: 400 },
  recordConcurrentUpdate: { status: 409 },
  recordNotFound: { status: 404 },
  recordVersionConflict: { status: 409, code: "version_conflict" },
  recordIdempotencyConflict: { status: 409, code: "idempotency_conflict" },
  recordOwnerRequired: { status: 400 },
  recordOwnerChangeForbidden: { status: 403 },
  recordCustomerNotFound: { status: 404 },
  tagNameConflict: { status: 409, code: "tag_name_exists", charset: false },
  tagColorConflict: { status: 409, code: "tag_color_conflict", charset: false },
  tagConflict: { status: 409, code: "tag_conflict", charset: false },
  tagNotFound: { status: 404 },
  tagDepartmentForbidden: { status: 403 },
  tagDepartmentRequired: { status: 400 },
  tagInUse: { status: 409, code: "tag_in_use", charset: false },
} satisfies Record<CommunicationErrorReason, ModuleErrorResponse>;
