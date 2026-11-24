import { Link, useLocation } from "@tanstack/react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";

import { payoutListSearchFromOrigin } from "./navigation";

export function PayoutBreadcrumbs() {
  const { pathname, search } = useLocation();
  const [, module, payoutId] = pathname.split("/");
  if (module !== "payouts") return null;

  return (
    <>
      <Separator
        orientation="vertical"
        className="mx-3 data-vertical:h-4 data-vertical:self-center"
      />
      <Breadcrumb aria-label="Payout 导航">
        <BreadcrumbList>
          <BreadcrumbItem>
            {payoutId ? (
              <BreadcrumbLink asChild>
                <Link to="/payouts" search={payoutListSearchFromOrigin(search)}>
                  Payout
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>Payout</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {payoutId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {payoutId === "new" ? "新建 Payout" : "Payout 详情"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
