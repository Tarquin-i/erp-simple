import type postgres from "postgres";

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
export async function ensureCustomerGuards(tx: postgres.TransactionSql) {
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
