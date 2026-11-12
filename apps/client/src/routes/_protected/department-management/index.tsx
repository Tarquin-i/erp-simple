import { createFileRoute, redirect } from "@tanstack/react-router";

import { DepartmentManagement } from "@/components/organization/department-management";
import { OrganizationLoadError } from "@/components/organization/organization-load-error";
import { listDepartmentRosters } from "@/request/organization";

export const Route = createFileRoute("/_protected/department-management/")({
  beforeLoad: ({ context }) => {
    if (context.viewer.role !== "company-admin")
      throw redirect({ to: "/", replace: true });
  },
  loader: listDepartmentRosters,
  component: DepartmentManagementRoute,
  errorComponent: () => <OrganizationLoadError title="暂时无法加载部门信息" />,
});

function DepartmentManagementRoute() {
  return <DepartmentManagement departments={Route.useLoaderData()} />;
}
