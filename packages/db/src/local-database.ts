import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";

const databaseEnvFile = fileURLToPath(
  new URL("../../../apps/server/.env", import.meta.url)
);

/**
 * 使用 Bun 原生解析后端配置及变量引用，补齐环境变量并保留命令行已设置的值。
 * @returns 加载完成时返回，无业务数据；配置文件不存在时继续使用已有环境。
 * @throws 配置文件无法读取、Bun 无法启动或未返回有效配置时抛出错误。
 */
export function loadDatabaseEnv() {
  try {
    accessSync(databaseEnvFile, constants.R_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("无法读取 apps/server/.env。", { cause: error });
  }
  // 让后端使用的同一运行时处理引用、引号和转义，避免维护另一套 .env 解析规则。
  // drizzle.config 也可能由 Node 执行，因此通过通用子进程 API 调用 Bun。
  const result = spawnSync(
    typeof Bun === "undefined" ? "bun" : process.execPath,
    [
      "--no-env-file",
      "--env-file",
      databaseEnvFile,
      "--eval",
      "process.stdout.write(JSON.stringify(process.env))",
    ],
    { env: { ...process.env }, encoding: "utf8" }
  );
  if (result.error) {
    throw new Error("无法启动 Bun 加载 apps/server/.env。", {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `Bun 加载 apps/server/.env 失败，退出码 ${result.status}。`
    );
  }
  let values: Record<string, string>;
  try {
    values = JSON.parse(result.stdout);
  } catch {
    // 子进程输出包含配置值，只在内存中解析，不把原文带入错误信息。
    throw new Error("Bun 未返回有效的 apps/server/.env 配置。");
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value;
  }
}

/**
 * 加载并校验 push、reset 和 seed 共用的本地数据库目标。
 * @returns 连接字符串、数据库名称及不含凭据的主机与库名说明。
 * @throws 缺少连接配置、处于生产环境、主机非回环地址或库名不属于本项目时拒绝执行。
 */
export function readLocalDatabaseConfig() {
  loadDatabaseEnv();
  const environmentKeys = ["NODE_ENV", "APP_ENV", "VERCEL_ENV", "ENVIRONMENT"];
  if (
    environmentKeys.some((key) =>
      ["prod", "production"].includes(
        process.env[key]?.trim().toLowerCase() ?? ""
      )
    )
  ) {
    throw new Error("生产环境不能执行本地数据库命令。");
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("请在 apps/server/.env 或环境变量中设置 DATABASE_URL。");
  }
  const target = URL.parse(url);
  if (!target || !["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("DATABASE_URL 必须是有效的 PostgreSQL 连接字符串。");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("本地数据库命令只能连接 localhost、127.0.0.1 或 [::1]。");
  }
  let name: string;
  try {
    name = decodeURIComponent(target.pathname.slice(1));
  } catch {
    throw new Error("DATABASE_URL 中的数据库名称编码无效。");
  }
  // app 是当前本地配置，erp-simple 是 Docker Compose 默认库名。
  if (name !== "app" && !/^erp-simple(?:_[a-z0-9_]+)?$/.test(name)) {
    throw new Error(
      "只能操作 app、erp-simple 或以 erp-simple_ 开头的本地开发和测试数据库。"
    );
  }
  process.env.DATABASE_URL = url;
  return {
    url,
    name,
    label: `${target.hostname}:${target.port || "5432"}/${name}`,
  };
}

/**
 * 提取数据库错误的实际原因，避免输出 SQL 参数、连接凭据和环境中的密钥。
 * @param error 数据库驱动、Drizzle 包装错误或命令输出。
 * @returns 保留具体原因及数据库错误码的脱敏说明。
 */
export function formatDatabaseError(error: unknown): string {
  let reason = error;
  while (reason instanceof Error && reason.cause instanceof Error) {
    reason = reason.cause;
  }
  let message = reason instanceof Error ? reason.message : String(reason);
  if (reason && typeof reason === "object" && "code" in reason) {
    message = `[${String(reason.code)}] ${message}`;
  }
  message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[DATABASE_URL]");
  const target = URL.parse(process.env.DATABASE_URL ?? "");
  const secrets = Object.entries(process.env)
    .filter(([key]) => /PASSWORD|SECRET|TOKEN|ACCESS_KEY/i.test(key))
    .map(([, value]) => value);
  if (target?.password) {
    secrets.push(target.password);
    try {
      secrets.push(decodeURIComponent(target.password));
    } catch {
      // 无效的密码编码由连接检查报告，格式化错误时仍可隐藏原始值。
    }
  }
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}
