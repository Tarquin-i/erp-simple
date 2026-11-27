import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressApiError } from "@/request/addresses";

export const addressCollectionClass =
  "mx-auto w-full max-w-4xl space-y-4 px-1 sm:px-3";

export const addressFormPageClass =
  "min-w-0 flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8";

export function AddressCollectionPending() {
  return (
    <div className={addressCollectionClass} role="status">
      <span className="sr-only">正在加载客户地址</span>
      <Skeleton aria-hidden="true" className="h-28 w-full" />
      <Skeleton aria-hidden="true" className="h-28 w-full" />
    </div>
  );
}

export function AddressPagePending() {
  return (
    <main
      className="min-w-0 flex-1 space-y-5 bg-background px-4 py-5 sm:p-6"
      aria-busy="true"
      aria-label="正在加载地址"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36 w-full" />
    </main>
  );
}

const addressFields = [
  "recipient",
  "phone",
  "country",
  "province",
  "city",
  "district",
  "addressLine1",
  "addressLine2",
  "postalCode",
];

function AddressFieldPending({
  className,
  multiline,
}: {
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Skeleton className="h-[1.375em] w-14 text-sm" />
      <Skeleton className={multiline ? "h-16 w-full" : "h-8 w-full"} />
    </div>
  );
}

export function AddressFormPending() {
  return (
    <main
      aria-busy="true"
      aria-label="正在加载地址"
      className={cn(addressFormPageClass, "space-y-5")}
    >
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-12.5 rounded-lg" />
          <Skeleton className="h-8 w-18 rounded-lg" />
        </div>
      </div>
      <AddressFieldPending />
      <div className="grid gap-4 sm:grid-cols-2">
        {addressFields.map((field) => (
          <AddressFieldPending
            key={field}
            className={field === "addressLine1" ? "sm:col-span-2" : undefined}
          />
        ))}
      </div>
      <AddressFieldPending multiline />
      <Skeleton className="h-[1.375em] w-28 text-sm" />
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
