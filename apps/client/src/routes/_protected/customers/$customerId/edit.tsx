import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  CustomerForm,
  CustomerFormLoadError,
  CustomerFormPending,
} from "@/components/customers/form";
import { readListQueryFromState } from "@/components/customers/list-query";
import {
  getCustomer,
  listAssignableCustomerOwners,
  listCustomerChannels,
} from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/$customerId/edit")({
  loader: {
    // 进入编辑页前等待资料更新，表单用加载结果建立初始草稿和版本。
    staleReloadMode: "blocking",
    handler: async ({ params, abortController, context }) => {
      const { signal } = abortController;
      const { customerId } = params;
      const { role } = context.viewer;
      // 编辑按客户原部门查询业务员，普通员工只展示当前负责人。
      const [{ customer }, { channels }, ownerOptions] = await Promise.all([
        getCustomer(customerId, signal),
        listCustomerChannels(signal),
        role === "supervisor" || role === "company-admin"
          ? listAssignableCustomerOwners(customerId, signal)
          : undefined,
      ]);
      return { customer, channels, assignableOwners: ownerOptions?.owners };
    },
  },
  pendingComponent: CustomerFormPending,
  errorComponent: CustomerFormLoadError,
  component: EditCustomerPage,
});

function EditCustomerPage() {
  const { customer, channels, assignableOwners } = Route.useLoaderData();
  const customerListQuery = useLocation({
    select: (location) => readListQueryFromState(location.state),
  });
  const navigate = Route.useNavigate();

  return (
    <CustomerForm
      key={customer.id}
      customer={customer}
      owner={{ id: customer.ownerUserId, name: customer.ownerName }}
      assignableOwners={assignableOwners}
      channels={channels}
      onCancel={() => {
        void navigate({
          to: "/customers/$customerId",
          params: { customerId: customer.id },
          state: { customerListQuery },
          replace: true,
        });
      }}
      onSaved={() =>
        navigate({ to: "/customers", search: customerListQuery, replace: true })
      }
    />
  );
}
