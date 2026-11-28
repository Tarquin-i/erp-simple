import { stripVTControlCharacters } from "node:util";
import postgres from "postgres";

import {
  formatDatabaseError,
  readLocalDatabaseConfig,
} from "../local-database";
import { ensureCustomerGuards } from "./customer-ownership-constraints";
import { ensureDepartmentTags } from "./department-tags";

/**
 * 执行现有 Drizzle Kit 命令并保留终端交互。
 * @returns Drizzle 同步完成时返回，无业务数据。
 * @throws 命令失败时抛出错误，包括 Drizzle 打印错误却返回退出码零的情况。
 */
async function runDrizzlePush() {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "node_modules/drizzle-kit/bin.cjs",
      "push",
    ],
    {
      // 将共享配置加载后的环境显式传给子进程，避免退回数据库包的旧 .env。
      env: { ...process.env },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "pipe",
    }
  );
  const stderr = await new Response(child.stderr).text();
  if (stderr) process.stderr.write(formatDatabaseError(stderr));
  // 0.31.11 的 PostgreSQL push 会捕获异常并用 console.error 输出。
  // 先移除终端颜色控制符，彩色 error: 同样按同步失败处理。
  const failed = /^(?:[\w.]*error|error \[\w+\]):/im.test(
    stripVTControlCharacters(stderr)
  );
  if ((await child.exited) !== 0 || failed) {
    throw new Error("Drizzle 表结构同步失败。");
  }
}

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
    // 保留同一数据库连接，跨越 Drizzle 子进程执行期间持有会话锁。
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
    await client.begin(ensureCustomerGuards);
    await client.begin(ensureDepartmentTags);
    await runDrizzlePush();
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
