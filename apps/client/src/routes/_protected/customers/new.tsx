import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/form";
import { readListQueryFromState } from "@/components/customers/list-query";
import {
  listAssignableCustomerOwners,
  listCustomerChannels,
} from "@/request/customers";
import { listDepartments } from "@/request/organization";

export const Route = createFileRoute("/_protected/customers/new")({
  loader: async ({ abortController, context }) => {
    const { signal } = abortController;
    const { role } = context.viewer;
    // 主管直接读取本部门成员，管理员先读取部门选项，选定后再查成员。
    const [{ channels }, ownerOptions, departments] = await Promise.all([
      listCustomerChannels(signal),
      role === "supervisor"
        ? listAssignableCustomerOwners(undefined, signal)
        : undefined,
      role === "company-admin" ? listDepartments(signal) : undefined,
    ]);
    return { channels, assignableOwners: ownerOptions?.owners, departments };
  },
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const { viewer } = Route.useRouteContext();
  const { channels, assignableOwners, departments } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => readListQueryFromState(location.state),
  });
  const navigate = Route.useNavigate();
  // 返回列表时恢复进入表单前的搜索、筛选和页码。
  const returnToList = () =>
    navigate({ to: "/customers", search: customerListQuery, replace: true });

  return (
    <CustomerForm
      owner={departments ? undefined : viewer.account}
      assignableOwners={assignableOwners}
      departments={departments}
      channels={channels}
      onCancel={() => void returnToList()}
      onSaved={returnToList}
    />
  );
}
