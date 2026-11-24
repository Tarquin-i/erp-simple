import { Link, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { AddressCollectionPending } from "@/components/addresses/load-state";
import { CustomerCommunicationTab } from "@/components/communication/list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Customer } from "@/request/customers";

import { readListQueryFromState } from "../list-query";
import { CustomerContacts } from "./contacts/contacts-tab";
import { isCustomerDetailTab, relatedTabs } from "./tabs";
import type { CustomerDetailTab } from "./tabs";

const CustomerAddressesTab = lazy(() => import("./addresses-tab"));

function DetailField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm wrap-anywhere">{children}</dd>
    </div>
  );
}

function CustomerRemark({ remark }: { remark: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    // 备注实际超出三行才显示展开按钮，容器宽度变化时重新测量。
    const element = paragraph.current;
    if (!element) return;
    function measure() {
      if (!element || expanded) return;
      setHasMore(element.scrollHeight > element.clientHeight);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, remark]);

  if (!remark) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <p
        ref={paragraph}
        id={id}
        className={`leading-6 whitespace-pre-wrap wrap-anywhere ${expanded ? "" : "line-clamp-3"}`}
      >
        {remark}
      </p>
      {(hasMore || expanded) && (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto px-0"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      )}
    </>
  );
}

export function CustomerDetail({
  customer,
  activeTab,
  productsTab,
  createProductAction,
  onTabChange,
}: {
  customer: Customer;
  activeTab: CustomerDetailTab;
  productsTab: ReactNode;
  createProductAction: ReactNode;
  onTabChange: (tab: CustomerDetailTab) => void;
}) {
  // 客户关联页签共用页签栏右侧的新建位置。
  const [tabActionsSlot, setTabActionsSlot] = useState<HTMLDivElement | null>(
    null
  );
  const tabViewport = useRef<HTMLDivElement>(null);
  const addressTabTrigger = useRef<HTMLButtonElement>(null);
  // 鼠标点击仅显示选中样式，键盘操作时保留焦点提示。
  const [pointerFocus, setPointerFocus] = useState(false);
  const tabTriggerClass = `min-w-[88px] focus-visible:border-transparent focus-visible:ring-0 ${pointerFocus ? "focus-visible:outline-none" : "focus-visible:outline-2 focus-visible:outline-offset-1"}`;
  const listQuery = readListQueryFromState(
    useRouterState({ select: (state) => state.location.state })
  );

  useEffect(() => {
    const viewport = tabViewport.current;
    const trigger = addressTabTrigger.current;
    if (activeTab !== "addresses" || !viewport || !trigger) return;

    // 窄屏右侧出现新建按钮后，仍让当前选中的地址页签完整可见。
    const revealAddressTab = () => {
      const overflow =
        trigger.getBoundingClientRect().right -
        viewport.getBoundingClientRect().right;
      if (overflow > 0) viewport.scrollLeft += Math.ceil(overflow);
    };
    revealAddressTab();
    const observer = new ResizeObserver(revealAddressTab);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeTab]);

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
            {customer.companyName}
          </h1>
          <p className="text-sm text-muted-foreground">客户详情</p>
        </div>
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
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <DetailField label="客户编号">
          <span className="tabular-nums">{customer.customerNo}</span>
        </DetailField>
        <DetailField label="标签">
          <div className="flex flex-wrap gap-1.5">
            {customer.tags.length ? (
              customer.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)
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
          <CustomerRemark remark={customer.remark} />
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
              <TabsTrigger className={tabTriggerClass} value="contacts">
                联系方式
              </TabsTrigger>
              {relatedTabs.map((tab) => (
                <TabsTrigger
                  ref={
                    tab.value === "addresses" ? addressTabTrigger : undefined
                  }
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
