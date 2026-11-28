import type { ModuleErrorResponse } from "../../../errors";
import type { OrganizationErrorReason } from "../application/errors";

export const organizationErrorResponses = {
  accountNotFound: { status: 401 },
  departmentMembershipRequired: { status: 403 },
  departmentAdministrationForbidden: { status: 403 },
  departmentNameConflict: { status: 409 },
  departmentNotFound: { status: 404 },
  applicantNotFound: { status: 404 },
  applicantAlreadyAssigned: { status: 409 },
  applicationReviewForbidden: { status: 403 },
  applicationNotFound: { status: 404 },
  departmentApplicationNotFound: { status: 404 },
  pendingApplicationExists: { status: 409 },
  applicationDepartmentNotFound: { status: 404 },
  applicationListForbidden: { status: 403 },
  otherDepartmentReviewForbidden: { status: 403 },
  applicationAlreadyReviewed: { status: 409 },
  supervisorCandidateNotFound: { status: 404 },
  supervisorCandidateIsAdministrator: { status: 409 },
  supervisorCandidateInOtherDepartment: { status: 409 },
  supervisorCandidateApplicationRequired: { status: 409 },
} satisfies Record<OrganizationErrorReason, ModuleErrorResponse>;
