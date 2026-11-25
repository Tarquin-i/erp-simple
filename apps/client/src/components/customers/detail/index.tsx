import { Link, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import { AddressCollectionPending } from "@/components/addresses/load-state";
import { CustomerCommunicationTab } from "@/components/communication/list";
import { DetailField } from "@/components/shared/detail-field";
import { ExpandableText } from "@/components/shared/expandable-text";
import { TagBadge } from "@/components/shared/tag-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Customer } from "@/request/customers";

import { readListQueryFromState } from "../list-query";
import { CustomerContacts } from "./contacts/contacts-tab";
import { isCustomerDetailTab, relatedTabs } from "./tabs";
import type { CustomerDetailTab } from "./tabs";

const CustomerAddressesTab = lazy(() => import("./addresses-tab"));

export function CustomerDetail({
  customer,
  activeTab,
  productsTab,
  archiveAction,
  createProductAction,
  onTabChange,
}: {
  customer: Customer;
  activeTab: CustomerDetailTab;
  productsTab: ReactNode;
  archiveAction: ReactNode;
  createProductAction: ReactNode;
  onTabChange: (tab: CustomerDetailTab) => void;
}) {
  // 客户关联页签共用页签栏右侧的新建位置。
  const [tabActionsSlot, setTabActionsSlot] = useState<HTMLDivElement | null>(
    null
  );
  const tabViewport = useRef<HTMLDivElement>(null);
  const activeTabTrigger = useRef<HTMLButtonElement>(null);
  // 鼠标点击仅显示选中样式，键盘操作时保留焦点提示。
  const [pointerFocus, setPointerFocus] = useState(false);
  const tabTriggerClass = `min-w-[88px] focus-visible:border-transparent focus-visible:ring-0 ${pointerFocus ? "focus-visible:outline-none" : "focus-visible:outline-2 focus-visible:outline-offset-1"}`;
  const listQuery = readListQueryFromState(
    useRouterState({ select: (state) => state.location.state })
  );

  useEffect(() => {
    const viewport = tabViewport.current;
    const trigger = activeTabTrigger.current;
    if (!viewport || !trigger) return;

    // 窄屏右侧出现新建按钮后，仍让当前页签完整可见。
    const revealActiveTab = () => {
      const tab = trigger.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      if (tab.right > bounds.right) {
        viewport.scrollLeft += Math.ceil(tab.right - bounds.right);
      } else if (tab.left < bounds.left) {
        viewport.scrollLeft -= Math.ceil(bounds.left - tab.left);
      }
    };
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeTab]);

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
            {customer.companyName}
          </h1>
          <p className="text-sm text-muted-foreground">客户详情</p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button asChild className="h-10 px-4">
            <Link
              to="/customers/$customerId/edit"
              params={{ customerId: customer.id }}
              state={{ customerListQuery: listQuery }}
            >
              <Pencil data-icon="inline-start" />
              编辑
            </Link>
          </Button>
          {archiveAction}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <DetailField label="客户编号">
          <span className="tabular-nums">{customer.customerNo}</span>
        </DetailField>
        <DetailField label="标签">
          <div className="flex flex-wrap gap-1.5">
            {customer.tags.length ? (
              customer.tags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  color={tag.color}
                  name={tag.name}
                  title={tag.name}
                />
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </DetailField>
        <DetailField label="渠道">
          <div className="flex flex-wrap gap-1.5">
            {customer.channels.length ? (
              customer.channels.map((channel) => (
                <Badge key={channel.code}>{channel.name}</Badge>
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </DetailField>
        <DetailField label="业务员">{customer.ownerName}</DetailField>
        <DetailField className="sm:col-span-2" label="备注">
          {customer.remark ? (
            <ExpandableText text={customer.remark} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </DetailField>
      </dl>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (isCustomerDetailTab(tab)) onTabChange(tab);
        }}
        className="mt-6 gap-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            ref={tabViewport}
            className="min-w-0 overflow-x-auto overflow-y-hidden py-1"
          >
            <TabsList
              aria-label="客户关联信息"
              animatedIndicator
              onPointerDownCapture={(event) => {
                if (
                  event.button === 0 &&
                  !event.ctrlKey &&
                  event.target instanceof Element &&
                  event.target.closest('[role="tab"]')
                ) {
                  setPointerFocus(true);
                }
              }}
              onKeyDownCapture={() => setPointerFocus(false)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setPointerFocus(false);
                }
              }}
            >
              <TabsTrigger
                ref={activeTab === "contacts" ? activeTabTrigger : undefined}
                className={tabTriggerClass}
                value="contacts"
              >
                联系方式
              </TabsTrigger>
              {relatedTabs.map((tab) => (
                <TabsTrigger
                  ref={tab.value === activeTab ? activeTabTrigger : undefined}
                  className={tabTriggerClass}
                  key={tab.value}
                  value={tab.value}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div
            ref={setTabActionsSlot}
            className="ml-auto shrink-0 empty:hidden"
          >
            {activeTab === "products" && createProductAction}
          </div>
        </div>
        <TabsContent value="contacts">
          <CustomerContacts
            customerId={customer.id}
            addButtonSlot={tabActionsSlot}
          />
        </TabsContent>
        {relatedTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {tab.value === "communication" ? (
              <CustomerCommunicationTab
                customerId={customer.id}
                createActionSlot={tabActionsSlot}
              />
            ) : tab.value === "products" ? (
              productsTab
            ) : tab.value === "addresses" ? (
              <Suspense fallback={<AddressCollectionPending />}>
                <CustomerAddressesTab
                  customer={customer}
                  createActionSlot={tabActionsSlot}
                />
              </Suspense>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                待开发
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
