import type { DatabaseTransaction } from "@repo/db";
import { customer, member } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

import {
  lockDepartment,
  readAccountRecordAccess,
  recordScopeWhere,
} from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { createCustomerError } from "../application/errors";
import { selectAssignableOwners } from "./owner-options";

/**
 * 写入前先共享锁定部门，再核对实时权限并锁定客户记录。
 * @param tx 调用方已经开启的写入事务。
 * @param access 调用方身份及最初的业务范围。
 * @param customerId 待修改或须保持归属的客户 ID。
 * @param lockMode 客户行锁模式。创建关联记录时可使用共享锁，修改客户及联系方式仍使用默认写锁。
 * @param includeArchived 归档请求可锁定已归档记录以确认重试结果。
 * @returns 重新读取的业务权限和已锁定的客户记录。
 * @throws 客户不存在或超出可见范围时抛出 profileWriteNotFound，权限复核失败时透传原异常。
 */
export async function lockCustomerForWrite(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  customerId: string,
  lockMode: "no key update" | "share" = "no key update",
  includeArchived = false
) {
  const activeOnly = includeArchived
    ? undefined
    : eq(customer.status, "active");
  const [target] = await tx
    .select({ departmentId: customer.departmentId })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        activeOnly,
        recordScopeWhere(access, customer)
      )
    );
  if (!target) throw createCustomerError("profileWriteNotFound");

  await lockDepartment(tx, target.departmentId, "share");
  // 等待部门锁期间，主管可能已失去部门级访问权限。
  const freshAccess = await readAccountRecordAccess(tx, access.userId);
  const [record] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.departmentId, target.departmentId),
        activeOnly,
        recordScopeWhere(freshAccess, customer)
      )
    )
    .for(lockMode);
  if (!record) throw createCustomerError("profileWriteNotFound");
  return { access: freshAccess, record };
}

/**
 * 验证业务员属于客户部门，并锁定其成员记录直到事务结束。
 * @param tx 当前业务写入事务。
 * @param departmentId 客户所属部门 ID。
 * @param ownerUserId 拟指派的业务员用户 ID。
 * @returns 校验通过后完成，无返回数据。
 * @throws 用户不在该部门或为公司管理员时抛出 profileOwnerNotAssignable。
 */
export async function requireAssignableOwner(
  tx: DatabaseTransaction,
  departmentId: string,
  ownerUserId: string
) {
  const [owner] = await selectAssignableOwners(
    tx,
    departmentId,
    ownerUserId
  ).for("share", { of: member });
  if (!owner) throw createCustomerError("profileOwnerNotAssignable");
}
