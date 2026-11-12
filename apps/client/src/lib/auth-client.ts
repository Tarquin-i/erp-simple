import { createAuthClient } from "better-auth/react";

// 浏览器请求同源的 /api/auth，开发环境由 Vite 转发给后端。
export const authClient = createAuthClient();
