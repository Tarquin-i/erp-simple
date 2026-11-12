export type Department = { id: string; name: string };

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

export async function submitDepartmentApplication(departmentId: string) {
  const response = await fetch(`${basePath}/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departmentId }),
  });
  await readResponse(response);
}
