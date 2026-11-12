import { createFileRoute, redirect } from "@tanstack/react-router";

import { DepartmentApprovals } from "@/components/organization/department-approvals";
import { OrganizationLoadError } from "@/components/organization/organization-load-error";
import { listPendingApplications } from "@/request/organization";

export const Route = createFileRoute("/_protected/department-approvals/")({
  beforeLoad: ({ context }) => {
    const { viewer } = context;
    if (viewer.role !== "supervisor" || !viewer.department)
      throw redirect({ to: "/", replace: true });
    return { department: viewer.department };
  },
  loader: listPendingApplications,
  component: DepartmentApprovalsRoute,
  errorComponent: () => <OrganizationLoadError title="暂时无法加载待审申请" />,
});

function DepartmentApprovalsRoute() {
  const { department } = Route.useRouteContext();
  return (
    <DepartmentApprovals
      department={department}
      applications={Route.useLoaderData()}
    />
  );
}
