import {
  Link,
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";

import { CommunicationDetail } from "@/components/communication/detail";
import { readCommunicationOrigin } from "@/components/communication/navigation";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
      aria-busy="true"
      aria-label="正在加载沟通详情"
      className="min-w-0 flex-1 space-y-5 bg-background px-4 py-6 sm:px-6"
    >
      <div
        aria-hidden="true"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <Skeleton className="h-8 w-44" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-17.5 rounded-lg" />
          <Skeleton className="h-8 w-17.5 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-32 w-full" />
    </main>
  ),
  errorComponent: ({ error }) => <CommunicationDetailError error={error} />,
});

function CommunicationDetailRoute() {
  const { communication } = Route.useLoaderData();
  const origin = Route.useSearch();
  // 客户归属可以单独变化，沟通版本相同也要应用新的客户权限和显示资料。
  const detailKey = JSON.stringify([
    communication.id,
    communication.version,
    communication.archiveStartedAt,
    communication.customer,
  ]);
  return (
    <CommunicationDetail
      key={detailKey}
      communication={communication}
      origin={origin}
    />
  );
}

function CommunicationDetailError({ error }: { error: unknown }) {
  const router = useRouter();
  const { state } = useLocation();
  const inaccessible =
    error instanceof CommunicationApiError && [403, 404].includes(error.status);
  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={1}>
            {inaccessible ? "无法查看此沟通记录" : "暂时无法加载沟通详情"}
          </EmptyTitle>
          {!inaccessible && (
            <p className="text-sm text-muted-foreground" role="alert">
              {error instanceof Error ? error.message : "请稍后重试。"}
            </p>
          )}
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link
              to="/communication"
              search={state.communicationListQuery ?? {}}
            >
              返回沟通列表
            </Link>
          </Button>
          {!inaccessible && (
            <Button onClick={() => void router.invalidate()}>重试</Button>
          )}
        </div>
      </Empty>
    </main>
  );
}
