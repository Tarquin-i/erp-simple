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

import { payoutListSearchFromOrigin, readPayoutListOrigin } from "./navigation";

export function PayoutBreadcrumbs() {
  const { pathname, search, state } = useLocation();
  const [, module, payoutId, action] = pathname.split("/");
  if (module !== "payouts") return null;
  const isEdit = action === "edit";

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
                <Link
                  to="/payouts"
                  search={payoutListSearchFromOrigin(search)}
                  activeOptions={{ exact: true }}
                >
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
                {isEdit ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to="/payouts/$payoutId"
                      params={{ payoutId }}
                      search={readPayoutListOrigin(search)}
                      state={{
                        payoutListEntryIndex: state.payoutListEntryIndex,
                      }}
                      activeOptions={{ exact: true }}
                      preload={false}
                      replace
                    >
                      Payout 详情
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>
                    {payoutId === "new" ? "新建 Payout" : "Payout 详情"}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {isEdit && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>编辑 Payout</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
