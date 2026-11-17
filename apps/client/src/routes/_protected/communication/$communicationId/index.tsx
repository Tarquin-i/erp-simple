import {
  Link,
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";

import { CommunicationDetail } from "@/components/communication/detail";
import { readCommunicationOrigin } from "@/components/communication/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CommunicationApiError,
  getCommunication,
} from "@/request/communication";

export const Route = createFileRoute(
  "/_protected/communication/$communicationId/"
)({
  validateSearch: readCommunicationOrigin,
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getCommunication(params.communicationId, abortController.signal),
  },
  component: CommunicationDetailRoute,
  pendingComponent: () => (
    <main
      className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
      aria-label="正在加载沟通详情"
    >
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-32 w-full" />
    </main>
  ),
  errorComponent: ({ error }) => <CommunicationDetailError error={error} />,
});

function CommunicationDetailRoute() {
  const { communication } = Route.useLoaderData();
  const { customerId } = Route.useSearch();
  // 客户归属可以单独变化，沟通版本相同也要应用新的客户权限和显示资料。
  const detailKey = JSON.stringify([
    communication.id,
    communication.version,
    communication.customer,
  ]);
  return (
    <CommunicationDetail
      key={detailKey}
      communication={communication}
      originCustomerId={customerId}
    />
  );
}

function CommunicationDetailError({ error }: { error: unknown }) {
  const router = useRouter();
  const { state } = useLocation();
  const inaccessible =
    error instanceof CommunicationApiError && [403, 404].includes(error.status);
  return (
    <main className="flex-1 space-y-4 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <h1 className="text-xl font-semibold">
        {inaccessible ? "无法查看此沟通记录" : "暂时无法加载沟通详情"}
      </h1>
      {!inaccessible && (
        <p className="text-sm text-muted-foreground" role="alert">
          {error instanceof Error ? error.message : "请稍后重试。"}
        </p>
      )}
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/communication" search={state.communicationListQuery ?? {}}>
            返回沟通列表
          </Link>
        </Button>
        {!inaccessible && (
          <Button onClick={() => void router.invalidate()}>重试</Button>
        )}
      </div>
    </main>
  );
}
