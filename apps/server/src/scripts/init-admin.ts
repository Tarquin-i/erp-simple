/**
 * `bun run auth:init-admin` 的入口。读取 `BOOTSTRAP_ADMIN_EMAIL`，首次创建时要求 `BOOTSTRAP_ADMIN_PASSWORD`。
 * 账号注册和管理员写入在同一事务内完成，事务锁与本地种子脚本共用，避免同时初始化。
 * 邮箱已对应公司管理员时直接成功。否则，已有其他管理员或邮箱已被注册时报告错误并设置退出码 1。
 */
import { APIError } from "better-auth/api";
import { database } from "../database";
import {
  CompanyAdminInitializationError,
  initializeCompanyAdmin,
} from "../modules/identity";

try {
  const created = await initializeCompanyAdmin(database.db, {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });

  console.log(created ? "公司管理员已创建。" : "公司管理员已初始化。");
} catch (error) {
  const message =
    error instanceof CompanyAdminInitializationError ||
    (error instanceof APIError && error.statusCode < 500)
      ? error.message
      : "初始化公司管理员失败，请检查数据库连接和表结构。";
  console.error(message);
  process.exitCode = 1;
} finally {
  await database.close();
}
