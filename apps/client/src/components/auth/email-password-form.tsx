import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      const { error: authError } = isRegister
        ? await authClient.signUp.email({
            name: email.split("@", 1)[0] || email,
            email,
            password,
          })
        : await authClient.signIn.email({ email, password });

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

      await navigate({ to: "/" });
    } catch {
      setError("请求失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <section className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <form onSubmit={handleSubmit} aria-busy={isSubmitting}>
          <fieldset className="space-y-4" disabled={isSubmitting}>
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium">
                邮箱
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className={inputClassName}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                minLength={isRegister ? 8 : undefined}
                maxLength={128}
                aria-describedby={isRegister ? "password-hint" : undefined}
                className={inputClassName}
                required
              />
              {isRegister && (
                <p id="password-hint" className="text-sm text-muted-foreground">
                  至少 8 个字符
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="h-10 w-full">
              {isSubmitting ? `${title}中…` : title}
            </Button>
          </fieldset>
        </form>
        <p className="text-sm text-muted-foreground">
          {isRegister ? "已有账号？" : "还没有账号？"}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            to={isRegister ? "/login" : "/register"}
          >
            {isRegister ? "去登录" : "去注册"}
          </Link>
        </p>
      </section>
    </main>
  );
}
