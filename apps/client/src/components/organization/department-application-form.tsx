import { type FormEvent, useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import type { Department } from "@/request/organization";

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
  const selectId = useId();
  const noDepartments = departments.length === 0;
  const disabled = busy || noDepartments;
  const initialDepartment = departments.find(
    ({ id }) => id === defaultDepartmentId
  );

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
          <Field>
            <FieldLabel htmlFor={selectId}>部门</FieldLabel>
            <select
              id={selectId}
              name="departmentId"
              className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
              defaultValue={initialDepartment?.id ?? ""}
              aria-describedby={
                noDepartments ? `${selectId}-description` : undefined
              }
              required
            >
              <option value="" disabled>
                {noDepartments ? "暂无可选部门" : "请选择部门"}
              </option>
              {departments.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            {noDepartments && (
              <FieldDescription id={`${selectId}-description`}>
                请联系公司管理员创建部门后再提交申请。
              </FieldDescription>
            )}
          </Field>
          <Button className="min-h-11" type="submit" disabled={disabled}>
            {busy ? "正在提交…" : "提交申请"}
          </Button>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
