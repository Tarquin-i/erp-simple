import postgres from "postgres";

import {
  formatDatabaseError,
  readLocalDatabaseConfig,
} from "../local-database";
import {
  assertExistingSchemaConstraints,
  pushSchemaInTransaction,
} from "../schema-push";
import { ensureCustomerGuards } from "./customer-ownership-constraints";
import { ensureDepartmentTags } from "./department-tags";

/**
 * 校验本地目标，持有同步锁执行表结构同步和客户归属约束安装。
 * @returns 同步成功时返回，无业务数据。
 * @throws 配置无效、目标不符、同步锁被占用或结构同步失败时抛出错误，并关闭连接。
 */
async function syncDatabase() {
  const { url, name: databaseName, label } = readLocalDatabaseConfig();
  const client = postgres(url, {
    connect_timeout: 5,
    idle_timeout: 0,
    max_lifetime: null,
    max: 1,
  });
  try {
    // 同一数据库连接在整个同步期间持有会话锁。
    const [lock] = await client<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(hashtext('erp:db:push')) as acquired
    `;
    if (!lock?.acquired)
      throw new Error("已有数据库同步正在执行，请稍后重试。");
    const [target] = await client<
      { name: string }[]
    >`select current_database() as name`;
    if (target?.name !== databaseName) {
      throw new Error("实际连接的数据库与同步目标不一致。");
    }
    console.log(`同步本地数据库 ${label}`);
    await assertExistingSchemaConstraints(client);
    await client.begin(ensureCustomerGuards);
    await client.begin(ensureDepartmentTags);
    await pushSchemaInTransaction(client);
    if (!(await client.begin(ensureCustomerGuards))) {
      throw new Error("数据库缺少客户或部门成员表，无法校验客户归属约束。");
    }
    await client.begin(ensureDepartmentTags);
  } finally {
    await client.end();
  }
}

try {
  await syncDatabase();
} catch (error) {
  console.error(formatDatabaseError(error));
  process.exitCode = 1;
}
