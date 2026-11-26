import type { Database } from "@repo/db";
import { createAccountProvisioning } from "../auth/account-provisioning";
import {
  findAccountWithAdminStatus,
  findAnyCompanyAdministrator,
  insertCompanyAdministrator,
  lockCompanyAdminInitialization,
} from "../persistence/company-administrators";

export class CompanyAdminInitializationError extends Error {}

/** 账号注册与管理员资格在同一事务提交。已初始化的账号返回 false。 */
export function initializeCompanyAdmin(
  db: Database,
  input: { email?: string; password?: string }
) {
  const email = input.email?.trim().toLowerCase();
  if (!email)
    throw new CompanyAdminInitializationError("请设置 BOOTSTRAP_ADMIN_EMAIL。");

  return db.transaction(async (tx) => {
    await lockCompanyAdminInitialization(tx);

    const account = await findAccountWithAdminStatus(tx, email);
    if (account?.adminId) return false;

    const admin = await findAnyCompanyAdministrator(tx);
    if (admin)
      throw new CompanyAdminInitializationError(
        "已有公司管理员，请核对初始化邮箱。"
      );
    if (account)
      throw new CompanyAdminInitializationError(
        "此邮箱已注册，请使用尚未注册的管理员邮箱。"
      );

    const { password } = input;
    if (!password)
      throw new CompanyAdminInitializationError(
        "请设置 BOOTSTRAP_ADMIN_PASSWORD。"
      );

    const { id } = await createAccountProvisioning(tx).registerAccount({
      name: "公司管理员",
      email,
      password,
    });
    await insertCompanyAdministrator(tx, id);
    return true;
  });
}
