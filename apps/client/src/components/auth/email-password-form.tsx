import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInWithEmail, signUpWithEmail } from "@/request/auth";

export function EmailPasswordForm({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === "register";
  const title = isRegister ? "注册" : "登录";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setError("");
    setIsSubmitting(true);

    try {
      const submit = isRegister ? signUpWithEmail : signInWithEmail;
      const { error: authError } = await submit({ email, password });

      if (authError) {
        if (!isRegister && authError.status === 401) {
          setError("邮箱或密码不正确。");
        } else if (
          isRegister &&
          authError.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
        ) {
          setError("此邮箱已注册，请直接登录。");
        } else {
          setError(`${title}失败，请稍后重试。`);
        }
        return;
      }

      await navigate({ to: "/", replace: true });
    } catch {
      setError("请求失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>
            {isRegister ? "注册后会自动登录。" : "使用已注册的邮箱登录。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} aria-busy={isSubmitting}>
            <FieldSet className="min-w-0" disabled={isSubmitting}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="min-h-11"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={
                      isRegister ? "new-password" : "current-password"
                    }
                    minLength={isRegister ? 8 : undefined}
                    maxLength={128}
                    aria-describedby={isRegister ? "password-hint" : undefined}
                    className="min-h-11"
                    required
                  />
                  {isRegister && (
                    <FieldDescription id="password-hint">
                      至少 8 个字符
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldError>{error}</FieldError>
                  <Button type="submit" className="min-h-11">
                    {isSubmitting ? `${title}中…` : title}
                  </Button>
                </Field>
              </FieldGroup>
            </FieldSet>
          </form>
          <FieldDescription className="text-center">
            {isRegister ? "已有账号？" : "还没有账号？"}{" "}
            <Link
              className="inline-flex min-h-11 items-center px-1 font-medium text-foreground"
              to={isRegister ? "/login" : "/register"}
            >
              {isRegister ? "去登录" : "去注册"}
            </Link>
          </FieldDescription>
        </CardContent>
      </Card>
    </main>
  );
}
