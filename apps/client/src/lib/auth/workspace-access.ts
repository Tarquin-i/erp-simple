import type { Viewer } from "@/request/organization";

export function canEnterWorkspace(viewer: Viewer) {
  return (
    viewer.role === "company-admin" ||
    (viewer.department !== null &&
      (viewer.role === "member" || viewer.role === "supervisor"))
  );
}
