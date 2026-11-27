import type postgres from "postgres";

const catalogs = ["customer", "communication"] as const;

async function moveLegacyTags(
  tx: postgres.TransactionSql,
  recordTable: (typeof catalogs)[number],
  hasAssignments: boolean
) {
  const tagTable = `${recordTable}_tag`;
  const assignmentTable = `${tagTable}_assignment`;
  const recordColumn = `${recordTable}_id`;
  const globalIndex = `${tagTable}_normalized_name_unique`;
  const departmentIndex = `${tagTable}_department_normalized_name_unique`;

  // 先取消全局名称唯一限制，再在新范围内写入分部副本。
  await tx`
    alter table public.${tx(tagTable)}
    add column if not exists department_id text
      constraint ${tx(`${tagTable}_department_id_organization_id_fk`)}
      references public.organization (id) on delete restrict
  `;
  // 兼容尚未记录标签创建人的旧库，外键和索引随后由 Drizzle 校验。
  await tx`alter table public.${tx(tagTable)} add column if not exists created_by_user_id text`;
  await tx`drop index if exists public.${tx(globalIndex)}`;
  await tx`
    create unique index if not exists ${tx(departmentIndex)}
    on public.${tx(tagTable)} (department_id, normalized_name)
  `;

  const referencedDepartments = hasAssignments
    ? tx`
        select distinct a.tag_id, r.department_id
        from public.${tx(assignmentTable)} a
        join public.${tx(recordTable)} r on r.id = a.${tx(recordColumn)}
        join legacy t on t.id = a.tag_id
      `
    : tx`select null::uuid as tag_id, null::text as department_id where false`;

  // 按已有记录拆分，未使用的标签才参考创建人的部门。无归属依据的标签保留原样。
  await tx`
    create temporary table tag_department_migration on commit drop as
    with legacy as (
      select id, created_by_user_id from public.${tx(tagTable)}
      where department_id is null
    ), referenced as (
      ${referencedDepartments}
    ), departments as (
      select tag_id, department_id from referenced
      union all
      select t.id, m.organization_id
      from legacy t join public.member m on m.user_id = t.created_by_user_id
      where not exists (select 1 from referenced r where r.tag_id = t.id)
    )
    select tag_id, department_id,
           case when row_number() over (
             partition by tag_id order by department_id
           ) = 1 then tag_id else gen_random_uuid() end as scoped_id
    from departments
  `;

  await tx`
    update public.${tx(tagTable)} t set department_id = m.department_id
    from pg_temp.tag_department_migration m
    where t.id = m.tag_id and m.scoped_id = m.tag_id
  `;
  await tx`
    insert into public.${tx(tagTable)}
      (id, name, color, created_by_user_id, created_at, department_id)
    select m.scoped_id, t.name, t.color, t.created_by_user_id, t.created_at, m.department_id
    from pg_temp.tag_department_migration m
    join public.${tx(tagTable)} t on t.id = m.tag_id
    where m.scoped_id <> m.tag_id
  `;
  if (hasAssignments) {
    await tx`
      update public.${tx(assignmentTable)} a set tag_id = m.scoped_id
      from public.${tx(recordTable)} r, pg_temp.tag_department_migration m
      where a.${tx(recordColumn)} = r.id and a.tag_id = m.tag_id
        and r.department_id = m.department_id and m.scoped_id <> m.tag_id
    `;
  }
  await tx`drop table pg_temp.tag_department_migration`;
}

/** 迁移旧标签，并在数据库层限制标签的归属和关联。 */
export async function ensureDepartmentTags(tx: postgres.TransactionSql) {
  await tx`set local lock_timeout = '5s'`;
  await tx`set local search_path = pg_catalog`;

  for (const recordTable of catalogs) {
    const tagTable = `${recordTable}_tag`;
    const assignmentTable = `${tagTable}_assignment`;
    const [state] = await tx<
      {
        hasTags: boolean;
        hasAssignments: boolean;
        needsMigration: boolean;
      }[]
    >`
      select to_regclass(${`public.${tagTable}`}) is not null as "hasTags",
             to_regclass(${`public.${assignmentTable}`}) is not null as "hasAssignments",
             (to_regclass(${`public.${tagTable}_normalized_name_unique`}) is not null
              or not exists (
                select 1 from pg_attribute
                where attrelid = to_regclass(${`public.${tagTable}`})
                  and attname = 'department_id' and not attisdropped
              )) as "needsMigration"
    `;
    if (!state?.hasTags || !state.needsMigration) continue;

    // 同步进程持有锁时旧版本仍可能读写数据库。先阻止旧写入再读取归属和移动关联。
    await tx`lock table public.member in share mode`;
    if (state.hasAssignments) {
      await tx`
        lock table public.${tx(recordTable)}, public.${tx(assignmentTable)}
        in share row exclusive mode
      `;
    }
    await moveLegacyTags(tx, recordTable, state.hasAssignments);
  }

  const [tables] = await tx<{ ready: boolean }[]>`
    select to_regclass('public.customer_tag_assignment') is not null
       and to_regclass('public.communication_tag_assignment') is not null
       as ready
  `;
  if (!tables?.ready) return;

  await tx`
    create or replace function public.enforce_tag_department()
    returns trigger language plpgsql set search_path = pg_catalog as $guard$
    begin
      if TG_OP = 'INSERT' then
        if new.department_id is not null then return new; end if;
      elsif new.department_id is not distinct from old.department_id then
        return new;
      end if;
      raise exception '标签和沟通记录的部门必须明确且不可变更。'
        using errcode = '23514', constraint = TG_TABLE_NAME || '_department_immutable';
    end;
    $guard$
  `;
  await tx`
    create or replace function public.enforce_tag_assignment_department()
    returns trigger language plpgsql set search_path = pg_catalog as $guard$
    declare
      record_department text;
      tag_department text;
    begin
      if TG_TABLE_NAME = 'customer_tag_assignment' then
        select c.department_id, t.department_id into record_department, tag_department
        from public.customer c cross join public.customer_tag t
        where c.id = new.customer_id and t.id = new.tag_id
        for key share of c, t;
      else
        select c.department_id, t.department_id into record_department, tag_department
        from public.communication c cross join public.communication_tag t
        where c.id = new.communication_id and t.id = new.tag_id
        for key share of c, t;
      end if;
      -- 缺少记录或标签时由现有外键处理。
      if found and tag_department is distinct from record_department then
        raise exception '标签和关联记录必须属于同一部门。'
          using errcode = '23514', constraint = TG_TABLE_NAME || '_department_check';
      end if;
      return new;
    end;
    $guard$
  `;
  for (const recordTable of catalogs) {
    const tagTable = `${recordTable}_tag`;
    const assignmentTable = `${tagTable}_assignment`;
    await tx`
      create or replace trigger tag_department_immutable
      before insert or update of department_id on public.${tx(tagTable)}
      for each row execute function public.enforce_tag_department()
    `;
    await tx`
      create or replace trigger tag_assignment_department_match
      before insert or update on public.${tx(assignmentTable)}
      for each row execute function public.enforce_tag_assignment_department()
    `;
  }
  // 客户已有独立约束。沟通的部门与标签关联建立后同样不可变更。
  await tx`
    create or replace trigger communication_department_immutable
    before update of department_id on public.communication
    for each row execute function public.enforce_tag_department()
  `;
}
