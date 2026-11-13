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

import { getCustomerListQuery } from "./customer-list-query";

export function CustomerBreadcrumbs() {
  const { pathname, state } = useLocation();
  const [, module, customerId, action] = pathname.split("/");
  if (module !== "customers") return null;

  const isNew = customerId === "new";
  const isEdit = action === "edit";
  const listQuery = getCustomerListQuery(state);

  return (
    <>
      <Separator
        orientation="vertical"
        className="mx-3 data-vertical:h-4 data-vertical:self-center"
      />
      <Breadcrumb aria-label="客户导航">
        <BreadcrumbList>
          <BreadcrumbItem>
            {customerId ? (
              <BreadcrumbLink asChild>
                <Link to="/customers" search={listQuery}>
                  客户
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>客户</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {customerId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isEdit ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to="/customers/$customerId"
                      params={{ customerId }}
                      state={{ customerListQuery: listQuery }}
                    >
                      客户详情
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>
                    {isNew ? "新建客户" : "客户详情"}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {isEdit && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>编辑客户</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
