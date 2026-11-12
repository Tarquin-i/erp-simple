import { useId } from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import type { Department } from "@/request/organization";

export function DepartmentSelect({
  departments,
  defaultDepartmentId,
  emptyDescription,
}: {
  departments: Department[];
  defaultDepartmentId?: string;
  emptyDescription?: string;
}) {
  const selectId = useId();
  const empty = departments.length === 0;
  const description = empty ? emptyDescription : undefined;
  const initialDepartment = departments.find(
    ({ id }) => id === defaultDepartmentId
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>部门</FieldLabel>
      <select
        id={selectId}
        name="departmentId"
        className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
        defaultValue={initialDepartment?.id ?? ""}
        aria-describedby={description ? `${selectId}-description` : undefined}
        disabled={empty}
        required
      >
        <option value="" disabled>
          {empty ? "暂无可选部门" : "请选择部门"}
        </option>
        {departments.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      {description && (
        <FieldDescription id={`${selectId}-description`}>
          {description}
        </FieldDescription>
      )}
    </Field>
  );
}
