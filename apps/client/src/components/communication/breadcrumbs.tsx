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

import { readCommunicationOrigin } from "./navigation";

export function CommunicationBreadcrumbs() {
  const { pathname, search, state } = useLocation();
  const [, module, communicationId, action] = pathname.split("/");
  if (module !== "communication") return null;

  const isEdit = action === "edit";
  const origin = readCommunicationOrigin(search);
  return (
    <>
      <Separator
        orientation="vertical"
        className="mx-3 data-vertical:h-4 data-vertical:self-center"
      />
      <Breadcrumb aria-label="沟通导航">
        <BreadcrumbList>
          <BreadcrumbItem>
            {communicationId ? (
              <BreadcrumbLink asChild>
                <Link
                  to="/communication"
                  search={state.communicationListQuery ?? {}}
                >
                  沟通
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>沟通</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {communicationId && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isEdit ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to="/communication/$communicationId"
                      params={{ communicationId }}
                      search={origin}
                      state={state}
                    >
                      沟通详情
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>
                    {communicationId === "new" ? "新建沟通" : "沟通详情"}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {isEdit && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>编辑沟通</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
