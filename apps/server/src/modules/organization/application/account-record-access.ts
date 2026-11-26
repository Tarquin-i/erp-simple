import type { Database, DatabaseTransaction } from "@repo/db";

import { fail } from "../../../errors";
import { selectAccountAccessRoles } from "../persistence/account-access-roles";

export type AccountRecordAccess =
  | { scope: "company"; userId: string }
  | { scope: "department"; userId: string; departmentId: string }
  | { scope: "own"; userId: string; departmentId: string };

/**
 * 根据管理员身份和部门成员关系计算账号的业务数据范围。
 * @param db 用于读取权限的数据库实例或当前事务。
 * @param userId 当前账号的用户 ID。
 * @returns 公司、部门或本人范围，部门和本人范围包含所属部门 ID。
 * @throws 账号不存在时抛出 HTTP 401，账号既非公司管理员也未加入部门时抛出 HTTP 403。
 */
export async function readAccountRecordAccess(
  db: Database | DatabaseTransaction,
  userId: string
): Promise<AccountRecordAccess> {
  const identity = await selectAccountAccessRoles(db, userId);
  if (!identity) fail(401, "请先登录。");
  if (identity.adminId) return { scope: "company", userId };
  if (!identity.membership) fail(403, "加入部门后才能访问业务数据。");

  const { departmentId, role } = identity.membership;
  return {
    scope: role === "supervisor" ? "department" : "own",
    userId,
    departmentId,
  };
}

/**
 * 在同一只读快照内读取账号权限并查询业务数据。
 * @param userId 已登录的用户 ID。
 * @param read 使用当前事务和快照内权限的查询。
 * @param db 组装模块时传入的数据库实例。
 * @returns 查询结果。
 * @throws 账号不存在或无业务权限时抛出 HTTP 401 或 403。
 */
export function withRecordReadSnapshot<T>(
  userId: string,
  read: (tx: DatabaseTransaction, access: AccountRecordAccess) => Promise<T>,
  db: Database
): Promise<T> {
  return db.transaction(
    async (tx) => read(tx, await readAccountRecordAccess(tx, userId)),
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
