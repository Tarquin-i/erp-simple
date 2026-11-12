import { authClient } from "@/lib/auth-client";

// 复用客户端的会话订阅，供首页显示当前登录状态。
export const useAuthSession = authClient.useSession;
