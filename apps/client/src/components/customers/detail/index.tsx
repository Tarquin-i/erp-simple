import { Link, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Customer } from "@/request/customers";

import { readListQueryFromState } from "../list-query";
import { CustomerContacts } from "./contacts/contacts-tab";

const relatedTabs = [
  { value: "communication", label: "沟通记录" },
  { value: "products", label: "产品" },
  { value: "orders", label: "订单" },
  { value: "addresses", label: "地址" },
];

const tabTriggerClass =
  "min-w-[88px] focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1";

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

export function CustomerDetail({ customer }: { customer: Customer }) {
  const [contactAddButtonSlot, setContactAddButtonSlot] =
    useState<HTMLDivElement | null>(null);
  const listQuery = readListQueryFromState(
    useRouterState({ select: (state) => state.location.state })
  );

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

      <Tabs defaultValue="contacts" className="mt-6 gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 overflow-x-auto overflow-y-hidden py-1">
            <TabsList aria-label="客户关联信息">
              <TabsTrigger className={tabTriggerClass} value="contacts">
                联系方式
              </TabsTrigger>
              {relatedTabs.map((tab) => (
                <TabsTrigger
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
            ref={setContactAddButtonSlot}
            className="ml-auto shrink-0 empty:hidden"
          />
        </div>
        <TabsContent value="contacts">
          <CustomerContacts
            customerId={customer.id}
            addButtonSlot={contactAddButtonSlot}
          />
        </TabsContent>
        {relatedTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <p className="py-8 text-center text-sm text-muted-foreground">
              待开发
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
