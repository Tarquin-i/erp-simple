import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * 创建 PostgreSQL 连接池和 Drizzle 查询实例，首次执行查询时建立连接。
 * @param url PostgreSQL 连接字符串。
 * @returns Drizzle 查询实例 `db`，以及 `checkConnection` 和 `close` 方法。
 * @throws 连接字符串无法解析时抛出错误。
 */
export function createDatabase(url: string) {
  const client = postgres(url, { connect_timeout: 5 });
  const db = drizzle(client);

  return {
    db,
    /**
     * 执行 `SELECT 1`，验证数据库可以连接并执行查询。
     * @returns 可等待的查询，成功后得到 `SELECT 1` 的结果行。
     * @throws 等待查询时，连接或查询失败会抛出错误。
     */
    checkConnection: () => db.execute(sql`SELECT 1`),
    /**
     * 关闭 PostgreSQL 连接池。
     * @returns 用于等待连接池关闭的 `Promise<void>`。
     */
    close: () => client.end(),
  };
}
