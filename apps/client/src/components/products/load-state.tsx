import { Link, useLocation, useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerApiError } from "@/request/customers";
import { ProductApiError } from "@/request/products";

import { productListDestination } from "./navigation";

export function ProductPagePending() {
  return (
    <main
      aria-busy="true"
      aria-label="正在加载产品"
      className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6"
    >
      <div aria-hidden="true" className="flex flex-wrap items-start gap-3">
        <div className="space-y-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
      <div aria-hidden="true" className="mt-6 space-y-3">
        <Skeleton className="h-6 w-16" />
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {["english", "customer", "type", "created", "updated"].map(
            (field) => (
              <div
                key={field}
                className={`space-y-1.5${field === "english" ? " sm:col-span-2" : ""}`}
              >
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-40" />
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}

export function ProductFormPending() {
  return (
    <main
      aria-busy="true"
      aria-label="正在加载产品"
      className="min-w-0 flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8"
    >
      <header
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-10 w-20" />
        </div>
      </header>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-6 w-16" />
        <div className="grid gap-4 sm:grid-cols-2">
          {["name", "english-name", "customer", "product-type"].map((field) => (
            <div key={field} className="grid gap-2">
              <Skeleton className="h-[1.375em] w-14 text-sm" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
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
  const resource = error instanceof CustomerApiError ? "客户" : "产品";
  const unavailable =
    (error instanceof ProductApiError || error instanceof CustomerApiError) &&
    [403, 404].includes(error.status);
  return (
    <main className="min-w-0 flex-1 bg-background p-5 sm:p-6">
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>
            {unavailable ? `无法查看此${resource}` : `暂时无法加载${resource}`}
          </EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : "请稍后重试。"}
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link {...productListDestination(state)} replace>
              {state.productCustomerList ? "返回客户产品" : "返回产品列表"}
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
