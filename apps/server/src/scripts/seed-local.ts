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
  user,
} from "@repo/db/schema";
import { and, eq, getTableName, inArray, or, sql } from "drizzle-orm";

import { readAddressCreateInput } from "../modules/address/input";
import type { DatabaseTransaction } from "../modules/identity/auth/better-auth";

const seedCustomerChannels = [
  { code: "huivo_international_station", name: "汇合国际站" },
  { code: "kingwin_international_station", name: "将为国际站" },
  { code: "huivo_alibaba", name: "汇合阿里巴巴" },
  { code: "kingwin_alibaba", name: "将为阿里巴巴" },
];

const seedDepartments = [
  { key: "a", name: "业务一部" },
  { key: "b", name: "业务二部" },
  { key: "engineering", name: "技术部" },
  { key: "product", name: "产品部" },
] as const;
type DepartmentKey = (typeof seedDepartments)[number]["key"];
type SeedAccount = { login: string; name: string } & (
  | { role: "company-admin" }
  | { role: "member" | "supervisor" | "applicant"; department: DepartmentKey }
);

// These credentials are intentionally public fixtures for local testing.
const seedPassword = "12345678";
const seedAccounts: readonly SeedAccount[] = [
  { login: "a", name: "公司管理员", role: "company-admin" },
  {
    login: "a1",
    name: "业务一部主管",
    role: "supervisor",
    department: "a",
  },
  {
    login: "a2",
    name: "业务一部员工",
    role: "member",
    department: "a",
  },
  {
    login: "b1",
    name: "业务二部主管",
    role: "supervisor",
    department: "b",
  },
  {
    login: "b2",
    name: "业务二部员工",
    role: "member",
    department: "b",
  },
  {
    login: "p",
    name: "业务二部待审员工",
    role: "applicant",
    department: "b",
  },
];

const seedIdPrefixes = {
  customer: "d0000001",
  contact: "d0000002",
  method: "d0000003",
  communication: "d0000004",
  customerTag: "d0000005",
  communicationTag: "d0000006",
  address: "d0000007",
} as const;

function seedId(kind: keyof typeof seedIdPrefixes, index: number) {
  return `${seedIdPrefixes[kind]}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const seedCustomerTags = ["重点客户", "打样中", "长期合作", "新客户"];
const seedCommunicationTags = ["需求确认", "报价沟通", "样品跟进", "交期确认"];
const seedCustomers = [
  {
    companyName: "演示·星河包装科技有限公司",
    department: "a",
    owner: "a1",
    contact: "林经理",
    remark: "关注彩盒印刷质量，本周确认首轮打样方案。",
  },
  {
    companyName: "演示·青禾文创工作室",
    department: "a",
    owner: "a1",
    contact: "陈女士",
    remark: "文创礼盒采购，需提供环保纸材与工艺建议。",
  },
  {
    companyName: "演示·晨光礼品贸易有限公司",
    department: "a",
    owner: "a2",
    contact: "周经理",
    remark: "节日礼品包装项目，先报价，再确认批量订单。",
  },
  {
    companyName: "演示·远山品牌设计有限公司",
    department: "a",
    owner: "a2",
    contact: "许先生",
    remark: "长期合作客户，偏好简洁设计和稳定交期。",
  },
  {
    companyName: "演示·海棠食品有限公司",
    department: "a",
    owner: "a2",
    contact: "吴经理",
    remark: "新品外盒需要防潮处理，待确认包装尺寸。",
  },
  {
    companyName: "演示·云帆跨境商贸有限公司",
    department: "a",
    owner: "a2",
    contact: "郑女士",
    remark: "跨境电商包装，需确认运输保护与外箱要求。",
  },
  {
    companyName: "演示·锦程印务有限公司",
    department: "b",
    owner: "b1",
    contact: "唐经理",
    remark: "计划分批采购，先确认纸张与印刷色差标准。",
  },
  {
    companyName: "演示·橙光活动策划有限公司",
    department: "b",
    owner: "b1",
    contact: "何女士",
    remark: "活动物料项目，交付时间较紧，需要优先跟进。",
  },
  {
    companyName: "演示·松果创意用品有限公司",
    department: "b",
    owner: "b2",
    contact: "赵经理",
    remark: "关注定制工艺，样品确认后安排后续报价。",
  },
  {
    companyName: "演示·南风文化传媒有限公司",
    department: "b",
    owner: "b2",
    contact: "孙先生",
    remark: "品牌周边包装，待客户提供最终设计稿。",
  },
  {
    companyName: "演示·拾光日用科技有限公司",
    department: "b",
    owner: "b2",
    contact: "冯女士",
    remark: "日用品套装礼盒，需比较两种材质方案。",
  },
  {
    companyName: "演示·知行教育用品有限公司",
    department: "b",
    owner: "b2",
    contact: "陆经理",
    remark: "教学用品包装，采购数量和交付批次待确认。",
  },
] as const;

const seedAddresses = [
  {
    index: 1,
    customerIndex: 1,
    input: {
      recipientName: "林经理",
      phone: "13800001001",
      province: "广东省",
      city: "深圳市",
      district: "宝安区",
      addressLine1: "演示产业园 A 座 2 楼",
      postalCode: "518101",
      remark: "办公室收样，工作日请联系收货人。",
    },
  },
  {
    index: 2,
    customerIndex: 1,
    input: {
      recipientName: "陈仓管",
      phone: "13800001002",
      province: "广东省",
      city: "东莞市",
      district: "长安镇",
      addressLine1: "演示物流园 2 号仓库",
      addressLine2: "北门卸货区",
      postalCode: "523850",
      remark: "批量彩盒从北门入库。",
    },
  },
  {
    index: 3,
    customerIndex: 1,
    input: {
      recipientName: "许师傅",
      phone: "13800001003",
      province: "广东省",
      city: "惠州市",
      district: "惠阳区",
      addressLine1: "演示包装基地 3 号收货口",
      remark: "供退换货和补件使用。",
    },
  },
  {
    index: 4,
    customerIndex: 3,
    input: {
      recipientName: "周经理",
      phone: "+8613800001004",
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      addressLine1: "演示文创园 5 幢 301 室",
      postalCode: "310000",
      remark: "礼品包装样品送到前台。",
    },
  },
  {
    index: 5,
    customerIndex: 6,
    input: {
      recipientName: "Alex Morgan",
      phone: "+1 651 555 0101",
      countryCode: "US",
      province: "Minnesota",
      city: "Saint Paul",
      addressLine1: "42 Sample Wharf",
      addressLine2: "Receiving Dock 2",
      postalCode: "55101",
      remark: "外箱注明演示采购单号，预约工作日收货。",
    },
  },
  {
    index: 6,
    customerIndex: 6,
    input: {
      recipientName: "Taylor Lee",
      phone: "+61 491 570 156",
      countryCode: "AU",
      province: "New South Wales",
      city: "Sydney",
      addressLine1: "18 Example Quay",
      postalCode: "2000",
      remark: "仅收跨境包装样品。",
    },
  },
  {
    index: 7,
    customerIndex: 7,
    input: {
      recipientName: "唐经理",
      phone: "13800001007",
      province: "江苏省",
      city: "苏州市",
      district: "吴中区",
      addressLine1: "演示印刷园 7 号厂房",
      postalCode: "215100",
    },
  },
  {
    index: 8,
    customerIndex: 9,
    input: {
      recipientName: "赵经理",
      phone: "13800001008",
      province: "福建省",
      city: "厦门市",
      district: "集美区",
      addressLine1: "演示创意产业园 1 幢 4 楼",
      postalCode: "361021",
      remark: "到货后送样品室。",
    },
  },
  {
    index: 9,
    customerIndex: 9,
    input: {
      recipientName: "Robin Chen",
      phone: "+1 416 555 0101",
      countryCode: "CA",
      province: "Ontario",
      city: "Toronto",
      addressLine1: "96 Example Lane",
      addressLine2: "Unit 3",
      postalCode: "M5V 2T6",
      remark: "海外样品收货点。",
    },
  },
] as const;

async function seedCustomerAddresses(
  tx: DatabaseTransaction,
  customerId: string,
  customerIndex: number,
  customerCreatedAt: Date
) {
  const addresses = seedAddresses.filter(
    (address) => address.customerIndex === customerIndex
  );
  if (!addresses.length) return 0;

  const [currentDefault] = await tx
    .select({ id: customerAddress.id })
    .from(customerAddress)
    .where(
      and(
        eq(customerAddress.customerId, customerId),
        eq(customerAddress.isDefault, true)
      )
    )
    .limit(1);
  let hasDefault = Boolean(currentDefault);
  let count = 0;
  for (const { index, input } of addresses) {
    const createdAt = new Date(customerCreatedAt.getTime() + index * 3600000);
    const [created] = await tx
      .insert(customerAddress)
      .values({
        ...readAddressCreateInput(input),
        id: seedId("address", index),
        customerId,
        isDefault: !hasDefault,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: customerAddress.id })
      .returning({ id: customerAddress.id });
    if (created) {
      hasDefault = true;
      count++;
    }
  }
  return count;
}

function resolveSeedTags(
  names: readonly string[],
  kind: "customerTag" | "communicationTag",
  rows: { id: string; normalizedName: string }[]
) {
  return new Map(
    names.map((name, index) => {
      const tag =
        rows.find((row) => row.id === seedId(kind, index + 1)) ??
        rows.find((row) => row.normalizedName === name.toLowerCase());
      if (!tag) throw new Error(`缺少种子标签：${name}。`);
      return [name, tag.id] as const;
    })
  );
}

async function seedBusinessData(
  tx: DatabaseTransaction,
  departmentIds: ReadonlyMap<DepartmentKey, string>
) {
  const owners = await tx
    .select({
      id: user.id,
      email: user.email,
      departmentId: member.organizationId,
    })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(
      inArray(user.email, ["a1@e.test", "a2@e.test", "b1@e.test", "b2@e.test"])
    );
  const ownerByLogin = new Map(
    owners.map((row) => [row.email.split("@")[0], row])
  );
  const customerTagValues = seedCustomerTags.map((name, index) => ({
    id: seedId("customerTag", index + 1),
    name,
  }));
  const communicationTagValues = seedCommunicationTags.map((name, index) => ({
    id: seedId("communicationTag", index + 1),
    name,
  }));
  await tx.insert(customerTag).values(customerTagValues).onConflictDoNothing();
  await tx
    .insert(communicationTag)
    .values(communicationTagValues)
    .onConflictDoNothing();
  const customerTags = resolveSeedTags(
    seedCustomerTags,
    "customerTag",
    await tx
      .select({
        id: customerTag.id,
        normalizedName: customerTag.normalizedName,
      })
      .from(customerTag)
      .where(
        or(
          inArray(
            customerTag.id,
            customerTagValues.map(({ id }) => id)
          ),
          inArray(customerTag.normalizedName, seedCustomerTags)
        )
      )
  );
  const communicationTags = resolveSeedTags(
    seedCommunicationTags,
    "communicationTag",
    await tx
      .select({
        id: communicationTag.id,
        normalizedName: communicationTag.normalizedName,
      })
      .from(communicationTag)
      .where(
        or(
          inArray(
            communicationTag.id,
            communicationTagValues.map(({ id }) => id)
          ),
          inArray(communicationTag.normalizedName, seedCommunicationTags)
        )
      )
  );

  const statuses = ["pending", "urgent", "completed"] as const;
  const additionalMethods = [
    "whatsapp",
    "linkedin",
    "kingwin_alibaba",
    "kingwin_international_station",
    "huivo_international_station",
  ] as const;
  const now = Date.now();
  let createdCustomers = 0;
  let createdCommunications = 0;
  let createdAddresses = 0;
  for (const [offset, definition] of seedCustomers.entries()) {
    const index = offset + 1;
    const departmentId = departmentIds.get(definition.department);
    const owner = ownerByLogin.get(definition.owner);
    const colleague = ownerByLogin.get(
      definition.owner.endsWith("1")
        ? `${definition.department}2`
        : `${definition.department}1`
    );
    if (
      !departmentId ||
      owner?.departmentId !== departmentId ||
      colleague?.departmentId !== departmentId
    ) {
      throw new Error(
        `种子业务员 ${definition.owner} 及同部门同事的部门配置不正确。`
      );
    }
    const customerId = seedId("customer", index);
    const createdAt = new Date(now - index * 86400000);
    const [created] = await tx
      .insert(customer)
      .values({
        id: customerId,
        companyName: definition.companyName,
        departmentId,
        ownerUserId: owner.id,
        remark: definition.remark,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: customer.id })
      .returning({ id: customer.id });
    const [record] = created
      ? [created]
      : await tx
          .select({ id: customer.id, departmentId: customer.departmentId })
          .from(customer)
          .where(eq(customer.id, customerId))
          .for("update");
    if (
      !record ||
      ("departmentId" in record && record.departmentId !== departmentId)
    ) {
      throw new Error(`客户种子标识 ${customerId} 的部门不匹配。`);
    }
    createdAddresses += await seedCustomerAddresses(
      tx,
      customerId,
      index,
      createdAt
    );
    if (created) {
      createdCustomers++;
      await tx
        .insert(customerChannelAssignment)
        .values(
          (definition.department === "a"
            ? ["huivo_international_station", "huivo_alibaba"]
            : ["kingwin_international_station", "kingwin_alibaba"]
          ).map((channelCode) => ({ customerId, channelCode }))
        );
      await tx
        .insert(customerTagAssignment)
        .values(
          [
            seedCustomerTags[offset % seedCustomerTags.length],
            seedCustomerTags[(offset + 1) % seedCustomerTags.length],
          ].map((name) => ({ customerId, tagId: customerTags.get(name)! }))
        );
      const contactId = seedId("contact", index);
      await tx
        .insert(customerContact)
        .values({ id: contactId, customerId, name: definition.contact });
      const additionalType =
        additionalMethods[offset % additionalMethods.length];
      const methods = [
        {
          type: "phone" as const,
          value: `1380000${String(index).padStart(4, "0")}`,
          isPrimary: true,
        },
        {
          type: "email" as const,
          value: `sales${index}@seed.example`,
          isPrimary: false,
        },
        {
          type: "wechat" as const,
          value: `demo_contact_${index}`,
          isPrimary: false,
        },
        {
          type: additionalType,
          value:
            additionalType === "whatsapp"
              ? `1390000${String(index).padStart(4, "0")}`
              : additionalType === "linkedin"
                ? `https://www.linkedin.com/in/demo-contact-${index}`
                : `demo_platform_${index}`,
          isPrimary: false,
        },
      ];
      await tx.insert(customerContactMethod).values(
        methods.map((method, methodIndex) => ({
          ...method,
          id: seedId("method", index * 10 + methodIndex),
          contactId,
        }))
      );
    }

    for (const step of [0, 1]) {
      const communicationId = seedId("communication", offset * 2 + step + 1);
      const [createdCommunication] = await tx
        .insert(communication)
        .values({
          id: communicationId,
          customerId,
          departmentId,
          ownerUserId: step === 0 ? owner.id : colleague.id,
          title: `${definition.companyName}｜${step === 0 ? "包装需求确认" : "样品报价与交期确认"}`,
          summary:
            step === 0
              ? `演示沟通：已与${definition.contact}确认初步需求。\n${definition.remark}\n下一步：整理规格、数量和工艺要求，发送确认清单。`
              : `演示沟通：由同部门同事协助跟进样品和报价。\n客户希望比较两种包装方案，需确认样品费用与预计交期。\n下一步：汇总反馈并更新沟通状态。`,
          status: statuses[(offset + step) % statuses.length],
          createdAt,
          updatedAt: new Date(now - (offset * 2 + step) * 3600000),
        })
        .onConflictDoNothing({ target: communication.id })
        .returning({ id: communication.id });
      if (createdCommunication) {
        createdCommunications++;
        await tx.insert(communicationTagAssignment).values(
          [
            seedCommunicationTags[step],
            seedCommunicationTags[2 + (offset % 2)],
          ].map((name) => ({
            communicationId,
            tagId: communicationTags.get(name)!,
          }))
        );
      }
    }
  }
  return { createdCustomers, createdCommunications, createdAddresses };
}

async function seedLocalData() {
  const target = readLocalDatabaseConfig();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret?.trim() || secret.length < 32) {
    throw new Error("请设置至少 32 字符的 BETTER_AUTH_SECRET。");
  }
  const { database, createProvisioningAuth } = await import(
    "../modules/identity/auth/better-auth"
  );

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
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('erp:init-company-admin'))`
      );
      const departmentIds = new Map<DepartmentKey, string>();
      for (const { key, name } of seedDepartments) {
        const slug = `erp-local-seed-${key}`;
        const [created] = await tx
          .insert(organization)
          .values({ id: crypto.randomUUID(), name, slug })
          .onConflictDoNothing({ target: organization.slug })
          .returning({ id: organization.id });
        const [department] = created
          ? [created]
          : await tx
              .select({ id: organization.id })
              .from(organization)
              .where(eq(organization.slug, slug))
              .limit(1);
        if (!department) throw new Error("种子部门不存在。");
        departmentIds.set(key, department.id);
      }

      const provisioningAuth = createProvisioningAuth(tx);
      let createdAccounts = 0;
      for (const definition of seedAccounts) {
        const email = `${definition.login}@e.test`;
        const [existing] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1);
        if (existing) continue;

        const { user: account } = await provisioningAuth.api.signUpEmail({
          body: { email, name: definition.name, password: seedPassword },
        });
        if (definition.role === "company-admin") {
          await tx.insert(companyAdministrator).values({ userId: account.id });
        } else {
          const organizationId = departmentIds.get(definition.department);
          if (!organizationId) throw new Error("种子部门不存在。");
          if (definition.role === "applicant") {
            await tx
              .insert(departmentApplication)
              .values({ userId: account.id, organizationId });
          } else {
            await provisioningAuth.api.addMember({
              body: {
                userId: account.id,
                organizationId,
                role: definition.role,
              },
            });
          }
        }
        createdAccounts++;
      }

      const createdChannels = await tx
        .insert(customerChannel)
        .values(seedCustomerChannels)
        .onConflictDoNothing({ target: customerChannel.code })
        .returning({ code: customerChannel.code });

      const business = await seedBusinessData(tx, departmentIds);
      return {
        createdAccounts,
        createdChannels: createdChannels.length,
        ...business,
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
    createdCustomers,
    createdCommunications,
    createdAddresses,
  } = await seedLocalData();
  console.log(
    `本地种子已就绪。新增账号 ${createdAccounts} 个，保留已有账号 ${seedAccounts.length - createdAccounts} 个，新增客户渠道 ${createdChannels} 项，客户 ${createdCustomers} 个，沟通 ${createdCommunications} 条，地址 ${createdAddresses} 条。`
  );
} catch (error) {
  console.error(formatDatabaseError(error));
  process.exitCode = 1;
}
