import { authClient } from "@/lib/auth-client";

// 路由进入前向 Better Auth 读取当前会话。
export const getAuthSession = authClient.getSession;
