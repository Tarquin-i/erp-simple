import { stripVTControlCharacters } from "node:util";
import postgres from "postgres";

import {
  formatDatabaseError,
  readLocalDatabaseConfig,
} from "../local-database";

const memberKey = "member_organization_user_unique";
const customerOwnerKey = "customer_department_owner_member_fk";
const customerDepartmentKey = "customer_id_department_unique";
const uniqueDefinition = "UNIQUE (organization_id, user_id)";
const customerDepartmentKeyDefinition = "UNIQUE (id, department_id)";
const foreignKeyDefinition =
  "FOREIGN KEY (department_id, owner_user_id) REFERENCES public.member(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT";
const departmentTriggerDefinition =
  "CREATE TRIGGER customer_department_immutable AFTER UPDATE ON public.customer FOR EACH ROW WHEN ((old.department_id IS DISTINCT FROM new.department_id)) EXECUTE FUNCTION public.reject_customer_department_change()";
const departmentTriggerBody = `
BEGIN
  RAISE EXCEPTION '客户不能跨部门转移。'
    USING ERRCODE = '23514', CONSTRAINT = 'customer_department_immutable';
END;
`;

/**
 * 在同一事务中校验现有客户归属，并先安装客户和沟通外键依赖的约束。
 * @param tx 当前 PostgreSQL 事务。
 * @returns 相关表已就绪并完成约束校验时返回 `true`，尚无完整表结构时返回 `false`。
 * @throws 已有客户归属无效、同名约束定义不符或数据库拒绝变更时中止事务。
 */
async function ensureCustomerGuards(tx: postgres.TransactionSql) {
  await tx`set local lock_timeout = '5s'`;
  await tx`set local search_path = pg_catalog`;
  const [tables] = await tx<{ member: boolean; customer: boolean }[]>`
    select to_regclass('public.member') is not null as member,
           to_regclass('public.customer') is not null as customer
  `;
  if (!tables?.member) {
    if (tables?.customer) {
      throw new Error("数据库已有客户表但缺少部门成员表，无法校验客户归属。");
    }
    return false;
  }

  const constraints = await tx<
    {
      name: string;
      definition: string;
      validated: boolean;
      deferrable: boolean;
    }[]
  >`
    select conname as name, pg_get_constraintdef(oid) as definition,
           convalidated as validated, condeferrable as deferrable
    from pg_constraint
    where (conrelid = 'public.member'::regclass and conname = ${memberKey})
       or (conrelid = to_regclass('public.customer')
           and conname in (${customerOwnerKey}, ${customerDepartmentKey}))
  `;
  const memberConstraint = constraints.find(({ name }) => name === memberKey);
  const ownerConstraint = constraints.find(
    ({ name }) => name === customerOwnerKey
  );
  const customerDepartmentConstraint = constraints.find(
    ({ name }) => name === customerDepartmentKey
  );
  if (
    memberConstraint &&
    (!memberConstraint.validated ||
      memberConstraint.deferrable ||
      memberConstraint.definition !== uniqueDefinition)
  ) {
    throw new Error(`部门成员约束 ${memberKey} 的定义不符合预期。`);
  }
  if (
    ownerConstraint &&
    (ownerConstraint.deferrable ||
      ownerConstraint.definition !==
        (ownerConstraint.validated
          ? foreignKeyDefinition
          : `${foreignKeyDefinition} NOT VALID`))
  ) {
    throw new Error(`客户负责人约束 ${customerOwnerKey} 的定义不符合预期。`);
  }
  if (
    customerDepartmentConstraint &&
    (!customerDepartmentConstraint.validated ||
      customerDepartmentConstraint.deferrable ||
      customerDepartmentConstraint.definition !==
        customerDepartmentKeyDefinition)
  ) {
    throw new Error(`客户部门约束 ${customerDepartmentKey} 的定义不符合预期。`);
  }
  if (tables.customer && !ownerConstraint?.validated) {
    const [invalidOwner] = await tx<{ id: string }[]>`
      select c.id
      from public.customer c
      where not exists (
        select 1 from public.member m
        where m.organization_id = c.department_id and m.user_id = c.owner_user_id
      )
      limit 1
    `;
    if (invalidOwner) {
      throw new Error(
        `客户 ${invalidOwner.id} 的负责人不属于客户部门，请先修正归属后重试。`
      );
    }
  }

  // Drizzle Kit 会先添加外键。已有表需先建立被引用的唯一约束。
  if (!memberConstraint) {
    await tx`alter table public.member add constraint ${tx(memberKey)} unique (organization_id, user_id)`;
  }
  if (!tables.customer) return false;

  // 已有库先补被引用的唯一约束，Drizzle 才能创建沟通的复合外键。
  if (!customerDepartmentConstraint) {
    await tx`alter table public.customer add constraint ${tx(customerDepartmentKey)} unique (id, department_id)`;
  }

  if (!ownerConstraint) {
    await tx`
      alter table public.customer add constraint ${tx(customerOwnerKey)}
      foreign key (department_id, owner_user_id)
      references public.member (organization_id, user_id)
      on delete restrict on update restrict
    `;
  } else if (!ownerConstraint.validated) {
    await tx`alter table public.customer validate constraint ${tx(customerOwnerKey)}`;
  }

  // Drizzle 表定义不包含触发器。列值变化时由数据库拒绝更新。
  const [trigger] = await tx<
    { definition: string; enabled: boolean; body: string }[]
  >`
    select pg_get_triggerdef(t.oid) as definition,
           t.tgenabled in ('O', 'A') as enabled, f.prosrc as body
    from pg_trigger t
    join pg_proc f on f.oid = t.tgfoid
    where t.tgrelid = 'public.customer'::regclass
      and t.tgname = 'customer_department_immutable'
  `;
  if (
    trigger?.definition !== departmentTriggerDefinition ||
    !trigger.enabled ||
    trigger.body !== departmentTriggerBody
  ) {
    await tx.unsafe(`
      create or replace function public.reject_customer_department_change()
      returns trigger language plpgsql as $guard$${departmentTriggerBody}$guard$
    `);
    await tx.unsafe(
      departmentTriggerDefinition.replace(
        "CREATE TRIGGER",
        "CREATE OR REPLACE TRIGGER"
      )
    );
    await tx`alter table public.customer enable trigger customer_department_immutable`;
  }
  return true;
}

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
    await runDrizzlePush();
    if (!(await client.begin(ensureCustomerGuards))) {
      throw new Error("数据库缺少客户或部门成员表，无法校验客户归属约束。");
    }
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
