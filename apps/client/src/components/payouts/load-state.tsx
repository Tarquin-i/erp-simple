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
      <div
        aria-hidden="true"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="space-y-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-17.5 rounded-lg" />
          <Skeleton className="h-8 w-17.5 rounded-lg" />
        </div>
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

export function PayoutFormPending() {
  return (
    <main
      aria-label="正在加载 Payout 表单"
      aria-busy="true"
      className="min-w-0 flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
    >
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-12.5 rounded-lg" />
          <Skeleton className="h-8 w-18 rounded-lg" />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
        {["product", "name", "count", "price"].map((field) => (
          <div key={field} className="grid gap-2">
            <Skeleton className="h-[1.375em] w-14 text-sm" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
        <div className="grid gap-2 sm:col-span-2">
          <Skeleton className="h-[1.375em] w-8 text-sm" />
          <Skeleton className="h-16 w-full" />
        </div>
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
