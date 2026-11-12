import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type Department,
  appointDepartmentSupervisor,
  createDepartment,
} from "@/request/organization";

import { DepartmentSelect } from "./department-select";

export function DepartmentManagement({
  departments,
}: {
  departments: Department[];
}) {
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">部门管理</h1>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <CreateDepartmentForm />
        <AppointSupervisorForm departments={departments} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>部门列表</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="text-muted-foreground">暂无部门。</p>
          ) : (
            <ul className="divide-y divide-border">
              {departments.map(({ id, name }) => (
                <li
                  key={id}
                  className="wrap-anywhere py-3 first:pt-0 last:pb-0"
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
      await router.invalidate();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>创建部门</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} aria-busy={busy}>
          <FieldSet className="min-w-0" disabled={busy}>
            <Field>
              <FieldLabel htmlFor={nameId}>部门名称</FieldLabel>
              <Input id={nameId} name="name" maxLength={80} required />
            </Field>
            <FieldError>{error}</FieldError>
            {success && <p role="status">{success}</p>}
            <Button type="submit" className="self-start">
              {busy ? "正在创建…" : "创建部门"}
            </Button>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}

function AppointSupervisorForm({ departments }: { departments: Department[] }) {
  const emailId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const noDepartments = departments.length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || noDepartments) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const departmentId = String(formData.get("departmentId") ?? "");
    const email = String(formData.get("email") ?? "").trim();
    setSuccess("");
    if (!departments.some(({ id }) => id === departmentId) || !email) {
      setError("请选择部门并填写员工邮箱。");
      return;
    }

    setError("");
    setBusy(true);
    try {
      await appointDepartmentSupervisor(departmentId, email);
      form.reset();
      setSuccess("主管已任命。");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>任命主管</h2>
        </CardTitle>
        <CardDescription>
          候选人需已申请加入该部门或已是该部门成员。更换主管后，原主管恢复为普通成员。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} aria-busy={busy}>
          <FieldSet className="min-w-0" disabled={busy || noDepartments}>
            <DepartmentSelect departments={departments} />
            <Field>
              <FieldLabel htmlFor={emailId}>员工邮箱</FieldLabel>
              <Input
                id={emailId}
                name="email"
                type="email"
                maxLength={254}
                required
              />
            </Field>
            <FieldError>{error}</FieldError>
            {success && <p role="status">{success}</p>}
            <Button type="submit" className="self-start">
              {busy ? "正在任命…" : "任命主管"}
            </Button>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}
