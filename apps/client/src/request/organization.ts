export type Department = { id: string; name: string };

type DepartmentAccount = { id: string; name: string; email: string };

export type DepartmentRoster = Department & {
  members: (DepartmentAccount & { role: "member" | "supervisor" })[];
  pendingApplicants: (DepartmentAccount & { applicationId: string })[];
};

export type PendingApplication = {
  id: string;
  name: string;
  email: string;
  submittedAt: string;
};

export type Viewer = {
  account: { id: string; name: string; email: string; image: string | null };
  role: "company-admin" | "supervisor" | "member" | "applicant";
  department: Department | null;
  application: {
    id: string;
    status: "pending" | "approved" | "rejected";
    department: Department;
    submittedAt: string;
    reviewedAt: string | null;
  } | null;
};

const basePath = "/api/organization";

/**
 * 解析组织接口的 JSON 响应，并将失败响应转为可在页面显示的错误。
 * @param response Fetch 返回的 HTTP 响应。
 * @returns 解析后的成功响应体。
 * @throws 收到 HTTP 错误响应时抛出包含后端提示或通用提示的 `Error`，成功响应无法解析时抛出解析错误。
 */
async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new Error(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。"
  );
}

/**
 * 查询当前登录账号的工作台身份、部门和最近一次入部申请。
 * @returns 当前账号的工作台信息。接口返回 HTTP 401 时返回 `null`。
 * @throws 网络请求失败、收到其他 HTTP 错误或响应解析失败时抛出异常，供路由显示加载失败。
 */
export async function getViewer(): Promise<Viewer | null> {
  const response = await fetch(`${basePath}/viewer`);
  if (response.status === 401) return null;
  return readResponse<Viewer>(response);
}

/**
 * 查询可选部门。
 * @param signal 可选的请求取消信号。
 * @returns 部门 ID 和名称的列表。
 * @throws 请求取消、失败或响应解析失败时抛出异常。
 */
export function listDepartments(signal?: AbortSignal) {
  return fetch(`${basePath}/departments`, { signal }).then(
    readResponse<Department[]>
  );
}

/**
 * 为公司管理员查询各部门的成员名册和待审申请人。
 * @returns 含成员及待审申请人的部门列表。
 * @throws 请求或响应解析失败时抛出异常。无管理权限时接口返回 HTTP 403。
 */
export function listDepartmentRosters() {
  return fetch(`${basePath}/admin/departments`).then(
    readResponse<DepartmentRoster[]>
  );
}

function post<T = unknown>(path: string, body: Record<string, string>) {
  return fetch(`${basePath}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(readResponse<T>);
}

/**
 * 向选定的部门提交入部申请，由调用方刷新页面上的申请状态。
 * @param departmentId 申请加入的部门 ID。
 * @returns 提交成功后完成，无返回数据。
 * @throws 请求失败时抛出异常，例如账号已有其他部门的待审申请。
 */
export async function submitDepartmentApplication(departmentId: string) {
  await post("/applications", { departmentId });
}

/**
 * 以公司管理员身份创建部门。
 * @param name 新部门的名称。
 * @returns 新部门的 ID 和名称。
 * @throws 请求或响应解析失败时抛出异常。名称已存在时接口返回 HTTP 409。
 */
export function createDepartment(name: string) {
  return post<Department>("/admin/departments", { name });
}

/**
 * 提交部门主管任命请求。
 * @param departmentId 要任命主管的部门 ID。
 * @param email 候选人的注册邮箱。
 * @returns `Promise<unknown>`，成功响应包含 `departmentId`、`userId` 和值为 `supervisor` 的 `role`。
 * @throws 请求失败时抛出异常，例如候选人已属于其他部门。
 */
export function appointDepartmentSupervisor(
  departmentId: string,
  email: string
) {
  return post(
    `/admin/departments/${encodeURIComponent(departmentId)}/supervisor`,
    { email }
  );
}

/**
 * 查询当前主管所在部门的待审入部申请。
 * @returns 申请列表，当前部门没有待审申请时为空数组。
 * @throws 请求或响应解析失败时抛出异常。当前账号不是部门主管时接口返回 HTTP 403。
 */
export function listPendingApplications() {
  return fetch(`${basePath}/applications`).then(
    readResponse<PendingApplication[]>
  );
}

/**
 * 提交对一条待审入部申请的审核决定。
 * @param id 入部申请 ID。
 * @param decision `approve` 表示通过，`reject` 表示拒绝。
 * @returns `Promise<unknown>`，成功响应包含 `id` 和 `status`，状态为 `approved` 或 `rejected`。
 * @throws 请求失败时抛出异常，例如申请已被处理。
 */
export function reviewDepartmentApplication(
  id: string,
  decision: "approve" | "reject"
) {
  return post(`/applications/${encodeURIComponent(id)}/review`, { decision });
}
