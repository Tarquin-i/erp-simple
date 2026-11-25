import { useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PayoutApiError } from "@/request/payouts";

import { useReturnToPayoutList } from "./navigation";

export function PayoutPagePending() {
  return (
    <main
      aria-label="正在加载 Payout"
      aria-busy="true"
      className="min-w-0 flex-1 space-y-6 bg-background px-4 py-6 sm:px-6"
    >
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-3">
        {["product", "tickets", "price"].map((key) => (
          <div key={key} className="space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
        ))}
      </div>
    </main>
  );
}

export function PayoutPageError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  const returnToList = useReturnToPayoutList();
  const unavailable =
    error instanceof PayoutApiError && [403, 404].includes(error.status);

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>
            {unavailable ? "无法查看此 Payout" : "暂时无法加载 Payout"}
          </EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : "请稍后重试。"}
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => returnToList(unavailable)}>
            返回列表
          </Button>
          {!unavailable && (
            <Button
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              重试
            </Button>
          )}
        </div>
      </Empty>
    </main>
  );
}
