import { Link, useLocation, useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressApiError } from "@/request/addresses";

export function AddressPagePending() {
  return (
    <main
      className="min-w-0 flex-1 space-y-5 bg-background p-5 sm:p-6"
      aria-busy="true"
      aria-label="正在加载地址"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36 w-full" />
    </main>
  );
}

/** 为地址页面提供一致的权限错误和加载重试入口。 */
export function AddressPageError({
  error,
  detail = false,
}: {
  error: unknown;
  detail?: boolean;
}) {
  const router = useRouter();
  const { state } = useLocation();
  const inaccessible =
    error instanceof AddressApiError && [403, 404].includes(error.status);
  return (
    <main className="min-w-0 flex-1 space-y-4 bg-background p-5 sm:p-6">
      <h1 className="text-xl font-semibold">
        {detail && inaccessible ? "无法查看此地址" : "暂时无法加载地址"}
      </h1>
      <FieldError>
        {error instanceof Error ? error.message : "请稍后重试。"}
      </FieldError>
      <div className="flex gap-2">
        {detail && (
          <Button asChild variant="outline">
            <Link to="/addresses" search={state.addressListQuery ?? {}}>
              返回地址列表
            </Link>
          </Button>
        )}
        {!inaccessible && (
          <Button onClick={() => void router.invalidate()}>重试</Button>
        )}
      </div>
    </main>
  );
}
