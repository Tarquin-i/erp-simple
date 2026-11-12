import { authClient } from "@/lib/auth-client";

// 路由进入前向 Better Auth 读取当前会话。
export const getAuthSession = authClient.getSession;

// 退出当前会话，由 Better Auth 清除会话 Cookie。
export const signOut = authClient.signOut;
