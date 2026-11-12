import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
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
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? "");
  const selectedDepartment = departments.find(({ id }) => id === departmentId);
  const empty = departments.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && selectedDepartment) onSubmit(selectedDepartment.id);
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy}>
      <FieldSet className="min-w-0 gap-3" disabled={busy || empty}>
        <FieldLegend variant="label">部门</FieldLegend>
        {empty ? (
          <FieldDescription>暂无可选部门，请联系公司管理员。</FieldDescription>
        ) : (
          <FieldGroup className="gap-2">
            {departments.map(({ id, name }) => (
              <FieldLabel
                key={id}
                className="min-h-11 w-full cursor-pointer gap-3 rounded-lg border border-input px-3 py-2 leading-5 transition-colors hover:bg-muted/50 has-[:checked]:border-ring has-[:checked]:bg-muted has-[:disabled]:cursor-default focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
              >
                <input
                  type="radio"
                  name="departmentId"
                  value={id}
                  checked={departmentId === id}
                  onChange={() => setDepartmentId(id)}
                  className="size-4 shrink-0 accent-primary"
                  required
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
              </FieldLabel>
            ))}
          </FieldGroup>
        )}
        <Button
          className="min-h-11 w-full"
          type="submit"
          disabled={!selectedDepartment || busy}
        >
          {busy ? "正在提交…" : "提交申请"}
        </Button>
      </FieldSet>
    </form>
  );
}
