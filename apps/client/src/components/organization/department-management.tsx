import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type Department,
  appointDepartmentSupervisor,
  createDepartment,
} from "@/request/organization";

export function DepartmentManagement({
  departments,
}: {
  departments: Department[];
}) {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<
    string | null
  >(null);
  const [appointing, setAppointing] = useState(false);
  const appointmentFormId = useId();

  return (
    <section className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">部门管理</h1>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="sm:py-2">
              <h2>部门列表</h2>
            </CardTitle>
            <CreateDepartmentForm />
          </div>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="py-4 text-muted-foreground">暂无部门。</p>
          ) : (
            <ul className="divide-y divide-border">
              {departments.map(({ id, name }) => {
                const expanded = selectedDepartmentId === id;

                return (
                  <li key={id} className="py-2.5">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <p className="min-w-0 wrap-anywhere font-medium">
                        {name}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-10 sm:min-h-8"
                        aria-label={
                          expanded
                            ? `收起${name}的主管任命`
                            : `为${name}任命主管`
                        }
                        aria-expanded={expanded}
                        aria-controls={expanded ? appointmentFormId : undefined}
                        disabled={appointing}
                        onClick={() =>
                          setSelectedDepartmentId(expanded ? null : id)
                        }
                      >
                        {expanded ? "收起" : "任命主管"}
                      </Button>
                    </div>
                    {expanded && (
                      <AppointSupervisorForm
                        id={appointmentFormId}
                        departmentId={id}
                        busy={appointing}
                        onBusyChange={setAppointing}
                      />
                    )}
                  </li>
                );
              })}
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

function AppointSupervisorForm({
  id,
  departmentId,
  busy,
  onBusyChange,
}: {
  id: string;
  departmentId: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const emailId = useId();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    setSuccess("");
    if (!email) {
      setError("请填写员工邮箱。");
      return;
    }

    setError("");
    onBusyChange(true);
    try {
      await appointDepartmentSupervisor(departmentId, email);
      form.reset();
      setSuccess("主管已任命。");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "请求失败，请稍后重试。"
      );
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <form
      id={id}
      className="mt-2.5 rounded-lg bg-muted/50 p-3"
      onSubmit={handleSubmit}
      aria-busy={busy}
    >
      <FieldSet className="min-w-0 gap-2" disabled={busy}>
        <div className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Field>
            <FieldLabel htmlFor={emailId}>员工邮箱</FieldLabel>
            <Input
              id={emailId}
              name="email"
              type="email"
              className="min-h-10 sm:min-h-8"
              aria-describedby={`${emailId}-hint`}
              maxLength={254}
              required
            />
          </Field>
          <Button type="submit" className="min-h-10 sm:min-h-8">
            {busy ? "正在任命…" : "任命主管"}
          </Button>
        </div>
        <p id={`${emailId}-hint`} className="text-xs text-muted-foreground">
          候选人需已申请或加入该部门。更换后，原主管恢复为普通成员。
        </p>
        <FieldError>{error}</FieldError>
        {success && <p role="status">{success}</p>}
      </FieldSet>
    </form>
  );
}
