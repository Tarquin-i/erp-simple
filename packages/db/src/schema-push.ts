import { pushSchema } from "drizzle-kit/api-postgres";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { ForeignKey } from "drizzle-orm/pg-core";
import type postgres from "postgres";

import * as schema from "./schema";

const dialect = new PgDialect();
const referenceActions = {
  "no action": "a",
  restrict: "r",
  cascade: "c",
  "set null": "n",
  "set default": "d",
} as const;

const requiredForeignKey = getTableConfig(
  schema.communication
).foreignKeys.find(
  (key) => key.getName() === "communication_customer_department_fk"
);
if (!requiredForeignKey) {
  throw new Error("缺少沟通客户外键的表结构声明。");
}

async function readCompatibleForeignKey(
  sql: postgres.ISql,
  foreignKey: ForeignKey
) {
  const name = foreignKey.getName();
  const source = getTableConfig(foreignKey.table);
  const { columns, foreignColumns, foreignTable } = foreignKey.reference();
  const target = getTableConfig(foreignTable);
  const sourceSchema = source.schema ?? "public";
  const targetSchema = target.schema ?? "public";
  const onUpdate = foreignKey.onUpdate ?? "no action";
  const onDelete = foreignKey.onDelete ?? "no action";
  const [state] = await sql<
    { definition: string; matches: boolean; validated: boolean }[]
  >`
    select
      pg_catalog.pg_get_constraintdef(c.oid) as definition,
      coalesce(
        c.contype = 'f'
        and c.confrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', ${targetSchema}::text, ${target.name}::text))
        and c.confupdtype = ${referenceActions[onUpdate]}
        and c.confdeltype = ${referenceActions[onDelete]}
        and c.confmatchtype = 's' and not c.condeferrable and not c.condeferred
        and array(
          select a.attname::text
          from unnest(c.conkey) with ordinality k(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          order by k.position
        ) = ${columns.map(({ name: column }) => column)}::text[]
        and array(
          select a.attname::text
          from unnest(c.confkey) with ordinality k(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
          order by k.position
        ) = ${foreignColumns.map(({ name: column }) => column)}::text[],
        false
      ) as matches,
      c.convalidated as validated
    from pg_catalog.pg_constraint c
    where c.conname = ${name}
      and c.conrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', ${sourceSchema}::text, ${source.name}::text))
  `;
  if (state && !state.matches) {
    const expected = `(${columns.map(({ name: column }) => column).join(", ")}) 引用 ${targetSchema}.${target.name}(${foreignColumns.map(({ name: column }) => column).join(", ")})，更新为 ${onUpdate}，删除为 ${onDelete}，MATCH SIMPLE 且不可延迟`;
    throw new Error(
      `外键 ${name} 的定义不符合预期。实际为 ${state.definition}，预期为 ${expected}。请通过显式迁移调整。`
    );
  }
  return state;
}

/** 在前置同步事务开始前拒绝已存在的非等价外键。 */
export async function assertExistingSchemaConstraints(sql: postgres.ISql) {
  if (requiredForeignKey)
    await readCompatibleForeignKey(sql, requiredForeignKey);
}

async function planSchema(tx: postgres.TransactionSql) {
  // Kit 只调用 execute 并从结果取得 rows。
  const database = {
    async execute(query: SQL) {
      const { sql, params } = dialect.sqlToQuery(query);
      return {
        rows: await tx.unsafe(
          sql,
          params as Parameters<postgres.TransactionSql["unsafe"]>[1]
        ),
      };
    },
  } as unknown as Parameters<typeof pushSchema>[1];
  return pushSchema(schema, database, {
    entities: undefined,
    schemas: ["public"],
    tables: [],
    extensions: [],
  });
}

function allowsAutomaticDdl(statement: string) {
  // 检查所有子句，避免把以 ADD 开头的复合 ALTER 误判为纯新增。
  const shape = statement
    .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/gu, "identifier")
    .replace(
      /\bON\s+(?:DELETE|UPDATE)\s+(?:RESTRICT|CASCADE|SET\s+(?:NULL|DEFAULT)|NO\s+ACTION)\b/giu,
      ""
    )
    .trim()
    .replace(/;$/u, "");
  return (
    /^(?:CREATE\s+(?:TABLE|TYPE|SEQUENCE|(?:UNIQUE\s+)?INDEX)\b|ALTER\s+TABLE\s+(?:identifier\.)?identifier\s+ADD\s+(?:COLUMN|CONSTRAINT)\b)/iu.test(
      shape
    ) &&
    !/;|\b(?:DROP|RENAME|TRUNCATE|DELETE|UPDATE|ALTER\s+COLUMN)\b/iu.test(shape)
  );
}

async function verifyForeignKey(
  tx: postgres.TransactionSql,
  foreignKey: ForeignKey
) {
  const before = await readCompatibleForeignKey(tx, foreignKey);
  const name = foreignKey.getName();
  if (!before) throw new Error(`表结构同步后缺少外键 ${name}。`);
  if (before.validated) return false;

  const source = getTableConfig(foreignKey.table);
  await tx`alter table ${tx(source.schema ?? "public")}.${tx(source.name)}
    validate constraint ${tx(name)}`;
  if (!(await readCompatibleForeignKey(tx, foreignKey))?.validated) {
    throw new Error(`外键 ${name} 尚未验证。`);
  }
  return true;
}

/** 生成并执行可自动同步的 DDL，重新核对差异后提交。 */
export async function pushSchemaInTransaction(
  client: postgres.Sql,
  assertSyncSession: (tx: postgres.TransactionSql) => Promise<void>
) {
  await client.begin(async (tx) => {
    await assertSyncSession(tx);
    await tx`set local lock_timeout = '5s'`;
    await tx`set local search_path = public`;
    const { sqlStatements, hints } = await planSchema(tx);
    const manualStatements = sqlStatements.filter(
      (statement) => !allowsAutomaticDdl(statement)
    );
    if (hints.length > 0 || manualStatements.length > 0) {
      throw new Error(
        [
          "表结构同步发现需要确认的变更，请通过显式迁移处理。",
          ...hints.map((hint) => JSON.stringify(hint)),
          ...manualStatements,
        ].join("\n")
      );
    }

    for (const statement of sqlStatements) {
      await tx.unsafe(statement).simple();
    }
    const validated = requiredForeignKey
      ? await verifyForeignKey(tx, requiredForeignKey)
      : false;
    if (sqlStatements.length > 0 || validated) {
      const next = await planSchema(tx);
      if (next.sqlStatements.length > 0 || next.hints.length > 0) {
        throw new Error(
          "表结构同步后仍存在差异，已回滚本阶段变更。\n" +
            next.sqlStatements.join("\n")
        );
      }
    }
    console.log(
      sqlStatements.length > 0 || validated
        ? `表结构同步完成，执行 ${sqlStatements.length} 条结构变更${validated ? "并补充外键校验" : ""}。`
        : "表结构无变更。"
    );
  });
}
