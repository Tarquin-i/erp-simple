export const seedDepartments = [
  { key: "a", name: "业务一部" },
  { key: "b", name: "业务二部" },
  { key: "engineering", name: "技术部" },
  { key: "product", name: "产品部" },
] as const;
export type DepartmentKey = (typeof seedDepartments)[number]["key"];
type SeedAccount = { login: string; name: string } & (
  | { role: "company-admin" }
  | { role: "member" | "supervisor" | "applicant"; department: DepartmentKey }
);

// 仅供本地演示的固定账号密码。
export const seedPassword = "12345678";
export const seedAccounts: readonly SeedAccount[] = [
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
