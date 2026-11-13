import {
  Link,
  createFileRoute,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { CustomerDetail } from "@/components/customers/detail";
import { readListQueryFromState } from "@/components/customers/list-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerApiError, getCustomer } from "@/request/customers";

export const Route = createFileRoute("/_protected/customers/$customerId/")({
  loader: ({ params, abortController }) =>
    getCustomer(params.customerId, abortController.signal),
  component: CustomerDetailRoute,
  pendingComponent: () => (
    <main
      className="flex-1 space-y-5 bg-background p-6"
      aria-label="正在加载客户详情"
    >
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-32 w-full" />
    </main>
  ),
  errorComponent: ({ error }) => <CustomerDetailError error={error} />,
});

function CustomerDetailRoute() {
  const { customer } = Route.useLoaderData();
  return <CustomerDetail key={customer.id} customer={customer} />;
}

function CustomerDetailError({ error }: { error: unknown }) {
  const router = useRouter();
  const listQuery = readListQueryFromState(
    useRouterState({ select: (state) => state.location.state })
  );
  const notFound = error instanceof CustomerApiError && error.status === 404;

  return (
    <main className="flex-1 space-y-4 bg-background p-6">
      <h1 className="text-xl font-semibold">
        {notFound ? "找不到该客户" : "暂时无法加载客户详情"}
      </h1>
      {!notFound && (
        <p className="text-sm text-muted-foreground" role="alert">
          {error instanceof Error ? error.message : "请稍后重试。"}
        </p>
      )}
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/customers" search={listQuery}>
            返回客户列表
          </Link>
        </Button>
        {!notFound && (
          <Button onClick={() => void router.invalidate()}>重试</Button>
        )}
      </div>
    </main>
  );
}
