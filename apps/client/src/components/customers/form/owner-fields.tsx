import { useEffect, useState } from "react";

import { SearchableSelect } from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { listAssignableCustomerOwners } from "@/request/customers";
import type { CustomerOwner } from "@/request/customers";
import type { Department } from "@/request/organization";

type DepartmentRoster = { departmentId: string } & (
  | { owners: CustomerOwner[]; error?: never }
  | { owners?: never; error: string }
);

/**
 * 展示客户表单的部门和业务员字段。
 * @param props `departments` 和 `departmentId` 供管理员新建时按部门加载业务员。其他场景使用传入的 `assignableOwners`。
 * `owner` 是当前业务员，`onDepartmentChange` 和 `onOwnerChange` 通知表单更新，`disabled` 控制选择操作。
 * @returns 传入 `departments` 时展示部门选择。业务员默认展示下拉框，未传 `departments` 和 `assignableOwners` 时展示只读字段。
 */
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
          <FieldLabel
            htmlFor="customer-form-department"
            preventControlActivation
          >
            部门
          </FieldLabel>
          <SearchableSelect
            id="customer-form-department"
            required
            disabled={disabled || !departments.length}
            items={departments}
            value={departments.find(({ id }) => id === departmentId) ?? null}
            placeholder={departments.length ? "请选择部门" : "暂无可选部门"}
            searchPlaceholder="搜索部门"
            emptyMessage="暂无可选部门"
            showSearch={false}
            getOptionKey={({ id }) => id}
            onValueChange={({ id }) => {
              if (id === departmentId) return;
              setOwnerLookup(undefined);
              onDepartmentChange(id);
            }}
          />
        </Field>
      )}
      <Field className="min-w-0">
        <FieldLabel
          htmlFor="customer-form-owner"
          preventControlActivation={Boolean(ownerOptions)}
        >
          业务员
        </FieldLabel>
        {ownerOptions ? (
          <SearchableSelect
            id="customer-form-owner"
            required={Boolean(departments)}
            disabled={disabled || !ownerOptions.length}
            busy={loadingOwners}
            items={ownerOptions}
            value={owner ?? null}
            placeholder={ownerPlaceholder}
            searchPlaceholder="搜索业务员"
            emptyMessage={ownerPlaceholder}
            showSearch={false}
            getOptionKey={({ id }) => id}
            onValueChange={onOwnerChange}
          />
        ) : (
          <Input
            id="customer-form-owner"
            className="bg-muted/25 text-muted-foreground"
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
