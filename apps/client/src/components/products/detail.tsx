import { Link } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DetailField } from "@/components/ui/detail-field";
import { productTypeLabels } from "@/request/products";
import type { ProductDetailRecord } from "@/request/products";

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type DetailValue = {
  label: string;
  value: ReactNode;
  className?: string;
};

function DetailSection({
  title,
  fields,
}: {
  title: string;
  fields: DetailValue[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {fields.map(({ label, value, className }) => (
          <DetailField key={label} label={label} className={className}>
            {value}
          </DetailField>
        ))}
      </dl>
    </section>
  );
}

export function ProductDetail({
  product,
  editAction,
  onArchive,
}: {
  product: ProductDetailRecord;
  editAction: ReactNode;
  onArchive: () => void;
}) {
  const typeLabel =
    product.productType === "user-defined" && product.customerDefinedType
      ? product.customerDefinedType
      : productTypeLabels[product.productType];
  const customer = product.customer;
  const basics: DetailValue[] = [
    {
      label: "英文名称",
      value: product.englishName,
      className: "sm:col-span-2",
    },
    {
      label: "所属客户",
      value: (
        <Link
          to="/customers/$customerId"
          params={{ customerId: customer.id }}
          className="underline-offset-4 hover:underline"
        >
          {customer.companyName}
          <span className="ml-2 text-muted-foreground">
            {customer.customerNo}
          </span>
        </Link>
      ),
    },
    { label: "产品类型", value: typeLabel },
    {
      label: "创建时间",
      value: (
        <time dateTime={product.createdAt}>
          {dateTime.format(new Date(product.createdAt))}
        </time>
      ),
    },
    {
      label: "更新时间",
      value: (
        <time dateTime={product.updatedAt}>
          {dateTime.format(new Date(product.updatedAt))}
        </time>
      ),
    },
  ];
  const specifications: DetailValue[] = [
    { label: "产品规格", value: product.specification },
    { label: "成品尺寸", value: product.finishedSize },
    { label: "纸张类型", value: product.paperType },
    { label: "色数", value: product.colorCount },
    { label: "表面处理", value: product.surfaceTreatment },
    { label: "最后成型", value: product.finalMolding },
    { label: "可变颜色", value: product.variableColor },
    { label: "变化方式", value: product.variationMethod },
    { label: "包装规格", value: product.packagingSpecification },
  ];
  if (product.productType === "pull-tab") {
    specifications.push(
      { label: "模切方向", value: product.dieCutDirection },
      { label: "揭开口数量", value: product.peelOffQuantity }
    );
  }
  if (
    product.productType === "lottery" ||
    product.productType === "scratch-card"
  ) {
    specifications.push({ label: "刮刮区", value: product.scratchOffArea });
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
            {product.name}
          </h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {product.productNo}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {editAction}
          <Button
            type="button"
            variant="destructive"
            className="h-10 px-4"
            aria-haspopup="dialog"
            onClick={onArchive}
          >
            <Archive data-icon="inline-start" />
            归档
          </Button>
        </div>
      </header>

      <div className="mt-6 space-y-5">
        <DetailSection title="基础信息" fields={basics} />
        <DetailSection title="规格工艺" fields={specifications} />
        <DetailSection
          title="价格"
          fields={[
            {
              label: "单价",
              value: <span className="tabular-nums">{product.unitPrice}</span>,
            },
            { label: "币种", value: product.currencyCode },
          ]}
        />
        {product.remark && (
          <dl>
            <DetailField label="备注">
              <p className="leading-6 whitespace-pre-wrap">{product.remark}</p>
            </DetailField>
          </dl>
        )}
      </div>
    </main>
  );
}
