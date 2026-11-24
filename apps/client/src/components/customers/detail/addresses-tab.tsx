import { Link, useLocation } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { createPortal } from "react-dom";

import { AddressCollection } from "@/components/addresses/address-collection";
import { Button } from "@/components/ui/button";
import type { AddressCustomer } from "@/request/addresses";

import { readListQueryFromState } from "../list-query";

/** 显示客户的有效地址，复用地址模块的列表和新建页面。 */
export default function CustomerAddressesTab({
  customer,
  createActionSlot,
}: {
  customer: AddressCustomer;
  createActionSlot: HTMLDivElement | null;
}) {
  const { state } = useLocation();

  return (
    <>
      {createActionSlot &&
        createPortal(
          <Button asChild size="icon">
            <Link
              to="/addresses/new"
              search={{ customerId: customer.id }}
              state={{ customerListQuery: readListQueryFromState(state) }}
              aria-label="新建地址"
              title="新建地址"
              preload={false}
            >
              <Plus aria-hidden="true" />
            </Link>
          </Button>,
          createActionSlot
        )}
      <AddressCollection key={customer.id} customerId={customer.id} />
    </>
  );
}
