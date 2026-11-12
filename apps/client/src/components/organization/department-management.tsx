import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type DepartmentRoster,
  createDepartment,
} from "@/request/organization";

import { DepartmentRosterCard } from "./department-roster-card";

export function DepartmentManagement({
  departments,
}: {
  departments: DepartmentRoster[];
}) {
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">部门管理</h1>
        <CreateDepartmentForm />
      </div>
      {departments.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-muted-foreground">暂无部门。</p>
          </CardContent>
        </Card>
      ) : (
        departments.map((department) => (
          <DepartmentRosterCard key={department.id} department={department} />
        ))
      )}
    </section>
  );
}

function CreateDepartmentForm() {
  const router = useRouter();
  const nameId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setSuccess("");
    if (!name) {
      setError("请输入部门名称。");
      return;
    }

    setError("");
    setBusy(true);
    try {
      await createDepartment(name);
      form.reset();
      setSuccess("部门已创建。");
      await router.invalidate({ sync: true });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="min-w-0 sm:w-72" onSubmit={handleSubmit} aria-busy={busy}>
      <FieldSet className="min-w-0 gap-2" disabled={busy}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <Field>
            <FieldLabel htmlFor={nameId} className="sr-only">
              部门名称
            </FieldLabel>
            <Input
              id={nameId}
              name="name"
              placeholder="部门名称"
              className="min-h-10 sm:min-h-8"
              maxLength={80}
              required
            />
          </Field>
          <Button type="submit" className="min-h-10 sm:min-h-8">
            {busy ? "正在创建…" : "创建部门"}
          </Button>
        </div>
        <FieldError>{error}</FieldError>
        {success && <p role="status">{success}</p>}
      </FieldSet>
    </form>
  );
}
