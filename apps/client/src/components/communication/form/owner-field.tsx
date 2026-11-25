import { useEffect, useState } from "react";

import { SearchableSelect } from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { listAssignableCustomerOwners } from "@/request/customers";
import type { CustomerOwner } from "@/request/customers";

type Roster =
  | { owners: CustomerOwner[]; error?: never }
  | {
      error: string;
      owners?: never;
    };

/** 客户确定后，只查询该客户原部门的可选业务员。 */
export function CommunicationOwnerField({
  customerId,
  editable,
  value,
  disabled,
  onChange,
}: {
  customerId?: string;
  editable: boolean;
  value?: CustomerOwner;
  disabled: boolean;
  onChange: (owner: CustomerOwner) => void;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel
        htmlFor="communication-form-owner"
        preventControlActivation={editable}
      >
        业务员
      </FieldLabel>
      {editable ? (
        <OwnerSelect
          key={customerId}
          customerId={customerId}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      ) : (
        <Input
          id="communication-form-owner"
          className="bg-muted/25 text-muted-foreground"
          value={value?.name ?? ""}
          readOnly
        />
      )}
    </Field>
  );
}

function OwnerSelect({
  customerId,
  value,
  disabled,
  onChange,
}: {
  customerId?: string;
  value?: CustomerOwner;
  disabled: boolean;
  onChange: (owner: CustomerOwner) => void;
}) {
  const [roster, setRoster] = useState<Roster>();
  const [retry, setRetry] = useState(0);
  const loading = Boolean(customerId && !roster);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    const { signal } = controller;
    listAssignableCustomerOwners(customerId, signal)
      .then(({ owners }) => {
        if (!signal.aborted) setRoster({ owners });
      })
      .catch((failure: unknown) => {
        if (signal.aborted) return;
        setRoster({
          error:
            failure instanceof Error ? failure.message : "业务员加载失败。",
        });
      });
    return () => controller.abort();
  }, [customerId, retry]);

  const placeholder = !customerId
    ? "请先选择客户"
    : loading
      ? "正在加载业务员…"
      : roster?.error
        ? "无法加载业务员"
        : roster?.owners?.length
          ? "请选择业务员"
          : "该部门暂无可选业务员";

  return (
    <>
      <SearchableSelect
        id="communication-form-owner"
        value={value ?? null}
        items={roster?.owners ?? []}
        disabled={disabled || !roster?.owners?.length}
        busy={loading}
        placeholder={placeholder}
        searchPlaceholder="搜索业务员"
        emptyMessage={placeholder}
        showSearch={false}
        getOptionKey={({ id }) => id}
        onValueChange={onChange}
      />
      {roster?.error ? (
        <div className="flex items-center gap-2">
          <FieldError>{roster.error}</FieldError>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="重试加载业务员"
            onClick={() => {
              setRoster(undefined);
              setRetry((attempt) => attempt + 1);
            }}
          >
            重试
          </Button>
        </div>
      ) : null}
    </>
  );
}
