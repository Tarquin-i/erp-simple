import { authClient } from "@/lib/auth-client";

// 用邮箱和密码登录。成功时由 Better Auth 写入会话 Cookie。
export const signInWithEmail = authClient.signIn.email;
