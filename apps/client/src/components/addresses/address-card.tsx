import { ChevronRight, Copy, Phone, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAddress,
  type AddressDetail,
  type AddressListItem,
} from "@/request/addresses";

import { AddressCardMenu } from "./address-card-menu";
import { copyAddressValue } from "./copy-address-value";
import { AddressPhoneValue } from "./phone-value";

type AddressCardActionsProps = {
  address: AddressListItem;
  detail?: AddressDetail;
  onChanged: (address: AddressDetail) => void | Promise<void>;
};

type AddressCardProps = Pick<
  AddressCardActionsProps,
  "address" | "onChanged"
> & {
  currentAddress?: AddressDetail;
};

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const detailRowClass =
  "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]";

/** 将当前可见的收货信息复制到剪贴板并提供地址操作菜单。 */
export function AddressCardActions({
  address,
  detail,
  onChanged,
}: AddressCardActionsProps) {
  const [copying, setCopying] = useState(false);

  async function copyAddress() {
    setCopying(true);
    const text = [
      `地址: ${address.formattedAddress}`,
      `联系人： ${address.recipientName}`,
      `联系方式： 电话-${address.phone}`,
    ].join("\n");
    try {
      await copyAddressValue(text, "已复制收货信息", "复制失败，请重试。");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="ml-auto flex shrink-0 items-start gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="复制收货信息"
        title="复制收货信息"
        disabled={copying}
        onClick={() => void copyAddress()}
      >
        <Copy aria-hidden="true" />
      </Button>
      <AddressCardMenu
        address={address}
        detail={detail}
        onChanged={onChanged}
      />
    </div>
  );
}

function AddressCardDetails({ address }: { address: AddressDetail }) {
  return (
    <dl className="space-y-3 border-l-2 border-border pl-3 text-sm sm:pl-4">
      {address.remark && (
        <div className={detailRowClass}>
          <dt className="text-muted-foreground">备注</dt>
          <dd className="wrap-anywhere whitespace-pre-wrap">
            {address.remark}
          </dd>
        </div>
      )}
      <div className={detailRowClass}>
        <dt className="text-muted-foreground">创建时间</dt>
        <dd className="tabular-nums">
          <time dateTime={address.createdAt}>
            {dateTime.format(new Date(address.createdAt))}
          </time>
        </dd>
      </div>
      <div className={detailRowClass}>
        <dt className="text-muted-foreground">更新时间</dt>
        <dd className="tabular-nums">
          <time dateTime={address.updatedAt}>
            {dateTime.format(new Date(address.updatedAt))}
          </time>
        </dd>
      </div>
    </dl>
  );
}

type DetailResult = { listVersion: number } & (
  | { address: AddressDetail }
  | { error: string }
);

function AddressCardDetailStatus({
  error,
  onRetry,
}: {
  error?: string;
  onRetry: () => void;
}) {
  if (!error) {
    return (
      <div aria-label="正在加载地址详情" aria-busy="true" className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full max-w-56" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FieldError>{error}</FieldError>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/**
 * 展示收货地址、收货人和联系电话，展开后显示补充资料。
 * @param props 地址摘要、可复用的当前详情以及更新回调。
 * @returns 独立展开的地址列表项。
 */
export function AddressCard({
  address,
  currentAddress,
  onChanged,
}: AddressCardProps) {
  const [open, setOpen] = useState(currentAddress !== undefined);
  const [loaded, setLoaded] = useState<DetailResult>();
  const { id, version } = address;
  const result = loaded?.listVersion === version ? loaded : undefined;
  const detail =
    currentAddress ??
    (result && "address" in result ? result.address : undefined);
  const loadError = result && "error" in result ? result.error : undefined;

  useEffect(() => {
    if (!open || currentAddress || result) return;

    const controller = new AbortController();
    const { signal } = controller;
    void getAddress(id, signal).then(
      ({ address: snapshot }) => {
        if (!signal.aborted)
          setLoaded({ listVersion: version, address: snapshot });
      },
      (error: unknown) => {
        if (!signal.aborted) {
          setLoaded({
            listVersion: version,
            error:
              (error instanceof Error && error.message) ||
              "暂时无法加载地址详情。",
          });
        }
      }
    );
    return () => controller.abort();
  }, [id, version, open, currentAddress, result]);

  return (
    <li>
      <Collapsible
        asChild
        open={open}
        onOpenChange={(expanded) => {
          setOpen(expanded);
          if (!expanded && loadError) setLoaded(undefined);
        }}
      >
        <Card className="gap-0 py-0 has-aria-[current=page]:ring-ring/40">
          <CardHeader className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={currentAddress ? "page" : undefined}
                  className="group/address -ml-2 gap-1 pr-0.5 aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
                >
                  收货地址
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground transition-transform motion-reduce:transition-none group-data-[state=open]/address:rotate-90"
                  />
                </Button>
              </CollapsibleTrigger>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {address.isDefault && (
                  <Star aria-hidden="true" className="size-3 shrink-0" />
                )}
                {address.isDefault ? "默认地址" : "普通地址"}
              </span>
            </div>
            <AddressCardActions
              address={address}
              detail={detail}
              onChanged={onChanged}
            />
          </CardHeader>
          <CardContent className="space-y-2 px-4 pt-2 pb-4">
            <p className="min-w-0 wrap-anywhere font-medium">
              {address.formattedAddress}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserRound aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">收货人</span>
                <span className="wrap-anywhere">{address.recipientName}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Phone aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">联系电话</span>
                <AddressPhoneValue phone={address.phone} />
              </span>
            </div>
          </CardContent>
          <CollapsibleContent>
            {open && (
              <CardContent className="px-4 pb-4">
                {detail ? (
                  <AddressCardDetails address={detail} />
                ) : (
                  <AddressCardDetailStatus
                    error={loadError}
                    onRetry={() => setLoaded(undefined)}
                  />
                )}
              </CardContent>
            )}
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </li>
  );
}
