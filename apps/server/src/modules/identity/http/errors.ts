import type { ModuleErrorResponse } from "../../../errors";

export const identityErrorResponses = {
  sessionRequired: { status: 401 },
} satisfies Record<string, ModuleErrorResponse>;
