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

export function ProductBreadcrumbs() {
  const { pathname, state } = useLocation();
  const [, module, productId, action] = pathname.split("/");
  if (module !== "products") return null;

  const isEdit = action === "edit";
  return (
    <>
      <Separator
        orientation="vertical"
        className="mx-3 data-vertical:h-4 data-vertical:self-center"
      />
      <Breadcrumb aria-label="产品导航">
        <BreadcrumbList>
          <BreadcrumbItem>
            {productId ? (
              <BreadcrumbLink asChild>
                <Link
                  to="/products"
                  search={state.productListQuery ?? {}}
                  activeOptions={{ exact: true }}
                >
                  产品
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>产品</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {productId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isEdit ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to="/products/$productId"
                      params={{ productId }}
                      state={{ productListQuery: state.productListQuery }}
                      activeOptions={{ exact: true }}
                      preload={false}
                      replace
                    >
                      产品详情
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>
                    {productId === "new" ? "新建产品" : "产品详情"}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {isEdit && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>编辑产品</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
