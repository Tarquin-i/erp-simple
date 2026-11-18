import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  formatDatabaseError,
  readLocalDatabaseConfig,
} from "../local-database";

/**
 * 清空本地应用 schema，再调用同步命令重建表结构。
 * @returns 重置和同步完成时返回，无业务数据。
 * @throws 目标不允许、同步正在执行或数据库操作失败时中止，同步失败时保留非零退出状态。
 */
async function resetLocalDatabase() {
  const { url, name: databaseName, label } = readLocalDatabaseConfig();
  const client = postgres(url, { connect_timeout: 5, max: 1 });

  try {
    await client.begin(async (tx) => {
      // 与 db:push 使用同一同步锁，获取失败时不会开始清空。
      const [lock] = await tx<{ acquired: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtext('erp:db:push')) as acquired
      `;
      if (!lock?.acquired) {
        throw new Error("已有数据库同步正在执行，请稍后重试。");
      }
      await tx`set local lock_timeout = '5s'`;
      const [target] = await tx<{ name: string }[]>`
        select current_database() as name
      `;
      if (!target || target.name !== databaseName) {
        throw new Error("实际连接的数据库与重置目标不一致。");
      }
      console.log(`正在清空并重建本地数据库 ${label}，所有现有数据将删除。`);
      await tx`drop schema if exists public cascade`;
      await tx`create schema public`;
      await tx`drop schema if exists drizzle cascade`;
    });
  } finally {
    // 先释放清空事务的锁和连接，db:push 会自行获取同步锁。
    await client.end();
  }

  const push = Bun.spawn(["bun", "run", "db:push"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await push.exited) !== 0) {
    throw new Error(
      "数据库已清空，但表结构同步失败，请重新运行 bun run db:push。"
    );
  }
  console.log("数据库已重置。运行 bun run seed 初始化本地账号和渠道。");
}

try {
  await resetLocalDatabase();
} catch (error) {
  console.error(formatDatabaseError(error));
  process.exitCode = 1;
}
