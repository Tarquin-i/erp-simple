import { companyAdministrator, user } from "@repo/db/schema";
import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";

import {
  createProvisioningAuth,
  database,
} from "../modules/identity/auth/better-auth";

class InitializationError extends Error {}

try {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new InitializationError("请设置 BOOTSTRAP_ADMIN_EMAIL。");

  const created = await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('erp:init-company-admin'))`
    );

    const [account] = await tx
      .select({ adminId: companyAdministrator.userId })
      .from(user)
      .leftJoin(companyAdministrator, eq(companyAdministrator.userId, user.id))
      .where(eq(user.email, email))
      .limit(1);
    if (account?.adminId) return false;

    const [admin] = await tx
      .select({ userId: companyAdministrator.userId })
      .from(companyAdministrator)
      .limit(1);
    if (admin)
      throw new InitializationError("已有公司管理员，请核对初始化邮箱。");
    if (account)
      throw new InitializationError(
        "此邮箱已注册，请使用尚未注册的管理员邮箱。"
      );

    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password)
      throw new InitializationError("请设置 BOOTSTRAP_ADMIN_PASSWORD。");

    const result = await createProvisioningAuth(tx).api.signUpEmail({
      body: { name: "公司管理员", email, password },
    });
    await tx.insert(companyAdministrator).values({ userId: result.user.id });
    return true;
  });

  console.log(created ? "公司管理员已创建。" : "公司管理员已初始化。");
} catch (error) {
  const message =
    error instanceof InitializationError ||
    (error instanceof APIError && error.statusCode < 500)
      ? error.message
      : "初始化公司管理员失败，请检查数据库连接和表结构。";
  console.error(message);
  process.exitCode = 1;
} finally {
  await database.close();
}
