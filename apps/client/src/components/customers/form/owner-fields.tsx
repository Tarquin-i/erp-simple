import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAssignableCustomerOwners } from "@/request/customers";
import type { CustomerOwner } from "@/request/customers";
import type { Department } from "@/request/organization";

type DepartmentRoster = { departmentId: string } & (
  | { owners: CustomerOwner[]; error?: never }
  | { owners?: never; error: string }
);

export function CustomerOwnerFields({
  departments,
  departmentId,
  onDepartmentChange,
  owner,
  assignableOwners,
  onOwnerChange,
  disabled,
}: {
  departments?: Department[];
  departmentId: string;
  onDepartmentChange: (id: string) => void;
  owner?: CustomerOwner;
  assignableOwners?: CustomerOwner[];
  onOwnerChange: (owner: CustomerOwner) => void;
  disabled: boolean;
}) {
  const [ownerLookup, setOwnerLookup] = useState<DepartmentRoster>();
  const [rosterRetry, setRosterRetry] = useState(0);
  // 结果按部门 ID 匹配，切换部门时旧名单不会显示在新部门下。
  const currentOwnerLookup =
    ownerLookup?.departmentId === departmentId ? ownerLookup : undefined;
  const loadingOwners = Boolean(departmentId && !currentOwnerLookup);
  const ownerOptions = departments
    ? (currentOwnerLookup?.owners ?? [])
    : assignableOwners;
  const ownerPlaceholder = !departmentId
    ? "请先选择部门"
    : loadingOwners
      ? "正在加载业务员…"
      : currentOwnerLookup?.error
        ? "无法加载业务员"
        : ownerOptions?.length
          ? "请选择业务员"
          : "该部门暂无可选业务员";

  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    const { signal } = controller;

    listAssignableCustomerOwners(undefined, signal, departmentId)
      .then(({ owners }) => {
        if (!signal.aborted) setOwnerLookup({ departmentId, owners });
      })
      .catch((failure: unknown) => {
        if (signal.aborted) return;
        setOwnerLookup({
          departmentId,
          error: failure instanceof Error ? failure.message : "请稍后重试。",
        });
      });

    // 部门切换、重试或组件卸载时取消上一次查询。
    return () => controller.abort();
  }, [departmentId, rosterRetry]);

  return (
    <>
      {departments && (
        <Field className="min-w-0">
          <FieldLabel htmlFor="customer-form-department">部门</FieldLabel>
          <Select
            required
            disabled={disabled || !departments.length}
            value={departmentId}
            onValueChange={(id) => {
              if (id === departmentId) return;
              setOwnerLookup(undefined);
              onDepartmentChange(id);
            }}
          >
            <SelectTrigger
              id="customer-form-department"
              className="w-full shadow-xs data-[size=default]:h-10"
            >
              <SelectValue
                placeholder={departments.length ? "请选择部门" : "暂无可选部门"}
              />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {departments.map(({ id, name }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field className="min-w-0">
        <FieldLabel htmlFor="customer-form-owner">业务员</FieldLabel>
        {ownerOptions ? (
          <Select
            required={Boolean(departments)}
            disabled={disabled || !ownerOptions.length}
            value={owner?.id ?? ""}
            onValueChange={(id) => {
              const selected = ownerOptions.find((owner) => owner.id === id);
              if (selected) {
                onOwnerChange(selected);
              }
            }}
          >
            <SelectTrigger
              id="customer-form-owner"
              aria-busy={loadingOwners}
              className="w-full shadow-xs data-[size=default]:h-10"
            >
              <SelectValue placeholder={ownerPlaceholder}>
                {owner?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {ownerOptions.map(({ id, name }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="customer-form-owner"
            className="h-10 bg-muted/25 text-muted-foreground shadow-xs"
            readOnly
            value={owner?.name ?? ""}
          />
        )}
        {currentOwnerLookup?.error && (
          <div className="flex items-center gap-2">
            <FieldError>{currentOwnerLookup.error}</FieldError>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="重试加载业务员"
              onClick={() => {
                setOwnerLookup(undefined);
                setRosterRetry((current) => current + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}
      </Field>
    </>
  );
}
