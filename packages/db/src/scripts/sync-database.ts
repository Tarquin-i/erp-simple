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
  let connectionCloses = 0;
  const client = postgres(url, {
    connect_timeout: 5,
    idle_timeout: 0,
    max_lifetime: null,
    max: 1,
    onclose: () => {
      connectionCloses += 1;
    },
  });
  try {
    // 同一数据库连接在整个同步期间持有会话锁。
    const [lock] = await client<{ acquired: boolean; pid: number }[]>`
      select pg_try_advisory_lock(hashtext('erp:db:push')) as acquired,
        pg_backend_pid() as pid
    `;
    if (!lock?.acquired)
      throw new Error("已有数据库同步正在执行，请稍后重试。");
    const lockPid = lock.pid;
    const closesAtLock = connectionCloses;

    async function assertSyncSession(sql: postgres.ISql) {
      const [session] = await sql<{ pid: number }[]>`
        select pg_backend_pid() as pid
      `;
      if (connectionCloses !== closesAtLock || session?.pid !== lockPid) {
        throw new Error(
          "数据库同步连接已断开，同步锁已释放。请重新运行 bun run db:push。"
        );
      }
    }

    // BEGIN 可能已换用重连后的会话，在实际执行该阶段的事务内核对。
    function runSyncStage<Result>(
      step: (tx: postgres.TransactionSql) => Promise<Result>
    ) {
      return client.begin(async (tx) => {
        await assertSyncSession(tx);
        return step(tx);
      });
    }

    const [target] = await client<
      { name: string }[]
    >`select current_database() as name`;
    if (target?.name !== databaseName) {
      throw new Error("实际连接的数据库与同步目标不一致。");
    }
    console.log(`同步本地数据库 ${label}`);
    await assertSyncSession(client);
    await assertExistingSchemaConstraints(client);
    await runSyncStage(ensureCustomerGuards);
    await runSyncStage(ensureDepartmentTags);
    await pushSchemaInTransaction(client, assertSyncSession);
    if (!(await runSyncStage(ensureCustomerGuards))) {
      throw new Error("数据库缺少客户或部门成员表，无法校验客户归属约束。");
    }
    await runSyncStage(ensureDepartmentTags);
  } finally {
    await client.end({ timeout: 5 });
  }
}

try {
  await syncDatabase();
} catch (error) {
  console.error(formatDatabaseError(error));
  process.exitCode = 1;
}
