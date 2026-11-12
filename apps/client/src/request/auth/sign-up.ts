import { authClient } from "@/lib/auth-client";

type EmailCredentials = {
  email: string;
  password: string;
};

// Better Auth 注册需要 name，表单只收集邮箱和密码，因此用邮箱前缀作为默认名称。
// 后端开启了注册后自动登录，注册成功时会直接建立会话。
export function signUpWithEmail({ email, password }: EmailCredentials) {
  return authClient.signUp.email({
    name: email.split("@", 1)[0] || email,
    email,
    password,
  });
}
