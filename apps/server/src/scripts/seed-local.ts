import { formatDatabaseError, readLocalDatabaseConfig } from "@repo/db/local";
import {
  account,
  companyAdministrator,
  communication,
  communicationTag,
  communicationTagAssignment,
  customer,
  customerAddress,
  customerChannel,
  customerChannelAssignment,
  customerContact,
  customerContactMethod,
  customerTag,
  customerTagAssignment,
  departmentApplication,
  member,
  organization,
  payout,
  product,
  user,
} from "@repo/db/schema";
import { getTableName, sql } from "drizzle-orm";

import { lockCompanyAdminInitialization } from "../modules/identity";
import { seedAccounts } from "./seed/account-definitions";
import { seedDevelopmentAccounts } from "./seed/accounts";
import { seedCustomers } from "./seed/customers";
import { seedDepartmentTags } from "./seed/department-tags";
import { seedPayouts } from "./seed/payouts";

async function seedLocalData() {
  const target = readLocalDatabaseConfig();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret?.trim() || secret.length < 32) {
    throw new Error("请设置至少 32 字符的 BETTER_AUTH_SECRET。");
  }
  const { database } = await import("../database");

  let stage: "connection" | "target" | "schema" | "write" = "connection";
  try {
    const [actual] = await database.db.execute<{ name: string }>(
      sql`select current_database() as name`
    );
    stage = "target";
    if (actual?.name !== target.name) {
      throw new Error(
        `实际连接的数据库与种子目标不一致，预期 ${target.name}，实际 ${actual?.name ?? "未知"}，已取消写入。`
      );
    }
    console.log(`本地种子目标：${target.label}`);
    stage = "schema";
    const requiredTables = [
      user,
      account,
      organization,
      member,
      companyAdministrator,
      departmentApplication,
      customerChannel,
      customer,
      customerAddress,
      customerTag,
      customerTagAssignment,
      customerChannelAssignment,
      customerContact,
      customerContactMethod,
      communication,
      communicationTag,
      communicationTagAssignment,
      product,
      payout,
    ].map(getTableName);
    const missingTables = await database.db.execute<{ name: string }>(sql`
      select name
      from unnest(array[${sql.join(
        requiredTables.map((name) => sql`${name}`),
        sql`, `
      )}]::text[]) as required(name)
      where to_regclass(format('public.%I', name)) is null
    `);
    if (missingTables.length) {
      throw new Error(
        `缺少数据表 ${missingTables.map(({ name }) => name).join("、")}，请先运行 bun run db:push。`
      );
    }

    stage = "write";
    return await database.db.transaction(async (tx) => {
      // Serialize this command with first-admin initialization and other seed runs.
      await lockCompanyAdminInitialization(tx);
      const { createdAccounts, departmentIds } =
        await seedDevelopmentAccounts(tx);
      const { tagIdsByDepartment, ...tagCounts } = await seedDepartmentTags(
        tx,
        departmentIds
      );
      const customerSeedCounts = await seedCustomers(
        tx,
        departmentIds,
        tagIdsByDepartment
      );
      return {
        createdAccounts,
        ...customerSeedCounts,
        ...tagCounts,
        createdPayouts: await seedPayouts(tx),
      };
    });
  } catch (error) {
    const detail = formatDatabaseError(error);
    if (stage === "connection") {
      throw new Error(`无法连接本地数据库 ${target.label}：${detail}`);
    }
    if (stage === "target") {
      throw new Error(`种子目标检查失败：${detail}`);
    }
    if (stage === "schema") {
      throw new Error(`种子表结构检查失败：${detail}`);
    }
    throw new Error(`初始化本地种子数据失败，事务已回滚：${detail}`);
  } finally {
    await database.close();
  }
}

try {
  const {
    createdAccounts,
    createdChannels,
    createdCustomerTags,
    createdCommunicationTags,
    createdCustomers,
    createdCommunications,
    createdAddresses,
    createdProducts,
    createdPayouts,
  } = await seedLocalData();
  console.log(
    `本地种子已就绪。新增账号 ${createdAccounts} 个，保留已有账号 ${seedAccounts.length - createdAccounts} 个，新增客户渠道 ${createdChannels} 项，客户标签 ${createdCustomerTags} 项，沟通标签 ${createdCommunicationTags} 项，客户 ${createdCustomers} 个，沟通 ${createdCommunications} 条，地址 ${createdAddresses} 条，产品 ${createdProducts} 条，奖表 ${createdPayouts} 份。`
  );
} catch (error) {
  console.error(formatDatabaseError(error));
  process.exitCode = 1;
}
