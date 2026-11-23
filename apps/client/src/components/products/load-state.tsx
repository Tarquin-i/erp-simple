import { Link, useLocation, useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductApiError } from "@/request/products";

export function ProductPagePending() {
  return (
    <main
      aria-busy="true"
      aria-label="正在加载产品"
      className="min-w-0 flex-1 space-y-5 bg-background p-5 sm:p-6"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36 w-full" />
    </main>
  );
}

export function ProductPageError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  const { state } = useLocation();
  const unavailable =
    error instanceof ProductApiError && [403, 404].includes(error.status);
  return (
    <main className="min-w-0 flex-1 bg-background p-5 sm:p-6">
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>
            {unavailable ? "无法查看此产品" : "暂时无法加载产品"}
          </EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : "请稍后重试。"}
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/products" search={state.productListQuery ?? {}} replace>
              返回产品列表
            </Link>
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
