import {
  companyAdministrator,
  departmentApplication,
  organization,
  user,
} from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";

const departmentNames = { a: "测试 A 部", b: "测试 B 部" } as const;
type DepartmentKey = keyof typeof departmentNames;
type SeedAccount = { login: string; name: string } & (
  | { role: "company-admin" }
  | { role: "member" | "supervisor" | "applicant"; department: DepartmentKey }
);

// These credentials are intentionally public fixtures for local testing.
const seedPassword = "ErpLocalSeed#2026";
const seedAccounts: readonly SeedAccount[] = [
  { login: "company-admin", name: "测试公司管理员", role: "company-admin" },
  {
    login: "lead-a",
    name: "测试 A 部主管",
    role: "supervisor",
    department: "a",
  },
  {
    login: "staff-a1",
    name: "测试 A 部员工 1",
    role: "member",
    department: "a",
  },
  {
    login: "staff-a2",
    name: "测试 A 部员工 2",
    role: "member",
    department: "a",
  },
  {
    login: "lead-b",
    name: "测试 B 部主管",
    role: "supervisor",
    department: "b",
  },
  {
    login: "staff-b1",
    name: "测试 B 部员工 1",
    role: "member",
    department: "b",
  },
  {
    login: "pending-b",
    name: "测试 B 部待审员工",
    role: "applicant",
    department: "b",
  },
];

function assertLocalDatabase() {
  if (process.env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("生产环境不能创建本地种子账号。");
  }
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (
    !url ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname.length < 2
  ) {
    throw new Error(
      "请将 DATABASE_URL 指向 127.0.0.1 或 localhost 上的本地数据库。"
    );
  }
}

async function seedLocalAccounts() {
  assertLocalDatabase();
  const { database, createProvisioningAuth } = await import(
    "../modules/identity/auth/better-auth"
  );

  try {
    return await database.db.transaction(async (tx) => {
      // Serialize this command with first-admin initialization and other seed runs.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('erp:init-company-admin'))`
      );
      const departmentIds = new Map<DepartmentKey, string>();
      for (const key of ["a", "b"] as const) {
        const slug = `erp-local-seed-${key}`;
        const [created] = await tx
          .insert(organization)
          .values({ id: crypto.randomUUID(), name: departmentNames[key], slug })
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
      let created = 0;
      for (const definition of seedAccounts) {
        const email = `${definition.login}@example.test`;
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
        created++;
      }
      return created;
    });
  } catch {
    throw new Error(
      "创建本地种子账号失败。请检查数据库表结构和种子部门的成员配置。"
    );
  } finally {
    await database.close();
  }
}

try {
  const created = await seedLocalAccounts();
  console.log(
    `本地种子已就绪。新增账号 ${created} 个，保留已有账号 ${seedAccounts.length - created} 个。`
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "本地种子初始化失败。"
  );
  process.exitCode = 1;
}
