import { authClient } from "@/lib/auth-client";

type EmailCredentials = {
  email: string;
  password: string;
};

/**
 * 用邮箱和密码注册，以邮箱前缀补齐 Better Auth 所需的名称。注册成功后由服务端建立会话。
 * @param credentials 注册使用的邮箱和密码。
 * @returns Better Auth 的注册结果。接口返回的注册错误通过 `error` 字段交给调用方处理。
 */
export function signUpWithEmail({ email, password }: EmailCredentials) {
  return authClient.signUp.email({
    name: email.split("@", 1)[0] || email,
    email,
    password,
  });
}
