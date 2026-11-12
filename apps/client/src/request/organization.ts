export type Department = { id: string; name: string };

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

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new Error(
    typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。"
  );
}

export async function getViewer(): Promise<Viewer | null> {
  const response = await fetch(`${basePath}/viewer`);
  if (response.status === 401) return null;
  return readResponse<Viewer>(response);
}

export function listDepartments() {
  return fetch(`${basePath}/departments`).then(readResponse<Department[]>);
}

function post<T = unknown>(path: string, body: Record<string, string>) {
  return fetch(`${basePath}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(readResponse<T>);
}

export async function submitDepartmentApplication(departmentId: string) {
  await post("/applications", { departmentId });
}

export function createDepartment(name: string) {
  return post<Department>("/admin/departments", { name });
}

export function appointDepartmentSupervisor(
  departmentId: string,
  email: string
) {
  return post(
    `/admin/departments/${encodeURIComponent(departmentId)}/supervisor`,
    { email }
  );
}

export function listPendingApplications() {
  return fetch(`${basePath}/applications`).then(
    readResponse<PendingApplication[]>
  );
}

export function reviewDepartmentApplication(
  id: string,
  decision: "approve" | "reject"
) {
  return post(`/applications/${encodeURIComponent(id)}/review`, { decision });
}
