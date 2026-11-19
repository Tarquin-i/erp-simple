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

/** 为侧栏地址目录和详情页显示面包屑。 */
export function AddressBreadcrumbs() {
  const { pathname, state } = useLocation();
  const [, module, addressId] = pathname.split("/");
  if (module !== "addresses") return null;
  return (
    <>
      <Separator
        orientation="vertical"
        className="mx-3 data-vertical:h-4 data-vertical:self-center"
      />
      <Breadcrumb aria-label="地址导航">
        <BreadcrumbList>
          <BreadcrumbItem>
            {addressId ? (
              <BreadcrumbLink asChild>
                <Link to="/addresses" search={state.addressListQuery ?? {}}>
                  地址
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>地址</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {addressId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>地址详情</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
