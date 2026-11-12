import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSet } from "@/components/ui/field";
import type { Department } from "@/request/organization";

import { DepartmentSelect } from "./department-select";

interface DepartmentApplicationFormProps {
  departments: Department[];
  defaultDepartmentId?: string;
  busy: boolean;
  onSubmit: (departmentId: string) => void;
}

export function DepartmentApplicationForm({
  departments,
  defaultDepartmentId,
  busy,
  onSubmit,
}: DepartmentApplicationFormProps) {
  const disabled = busy || departments.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const departmentId = new FormData(event.currentTarget).get("departmentId");
    if (
      typeof departmentId === "string" &&
      departments.some(({ id }) => id === departmentId)
    ) {
      onSubmit(departmentId);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy}>
      <FieldSet className="min-w-0" disabled={disabled}>
        <FieldGroup>
          <DepartmentSelect
            departments={departments}
            defaultDepartmentId={defaultDepartmentId}
            emptyDescription="请联系公司管理员创建部门后再提交申请。"
          />
          <Button className="min-h-11" type="submit" disabled={disabled}>
            {busy ? "正在提交…" : "提交申请"}
          </Button>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
