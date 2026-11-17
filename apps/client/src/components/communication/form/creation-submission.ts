import type { CreateCommunicationInput } from "@/request/communication";

import type { CommunicationDraft } from "./draft";

export type CreationSubmission = Omit<CreateCommunicationInput, "tagIds"> & {
  id: string;
  tags: CommunicationDraft["tags"];
};

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function creationStorageKey(
  accountId: string,
  originCustomerId?: string
) {
  return `communication-submission:v1:${JSON.stringify([accountId, originCustomerId])}`;
}

export function createSubmissionId() {
  // 部署在局域网 HTTP 时 randomUUID 不可用，getRandomValues 仍可生成 UUID v4。
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isSubmission(value: unknown): value is CreationSubmission {
  if (!value || typeof value !== "object") return false;
  const submission = value as Partial<CreationSubmission>;
  return (
    isUuid(submission.id) &&
    isUuid(submission.customerId) &&
    typeof submission.title === "string" &&
    typeof submission.summary === "string" &&
    (submission.ownerUserId === undefined ||
      typeof submission.ownerUserId === "string") &&
    Array.isArray(submission.tags) &&
    submission.tags.every(
      (tag) => tag && isUuid(tag.id) && typeof tag.name === "string"
    )
  );
}

/** 读取本标签页中仍待确认的原始请求，按当前账号和新建入口隔离。 */
export function readCreationSubmission(key: string): CreationSubmission | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (isSubmission(value)) return value;
  } catch {
    // 恢复记录不可读时不另起一次提交，以免重复新建。
  }
  throw new Error("无法读取本地提交记录。请恢复浏览器站点存储后重试。");
}

export function storeCreationSubmission(
  key: string,
  submission: CreationSubmission
) {
  try {
    sessionStorage.setItem(key, JSON.stringify(submission));
  } catch {
    throw new Error(
      "无法保留本地提交记录，尚未发送请求。请恢复浏览器站点存储后重试。"
    );
  }
}

/** 仅清除已确认提交，保留同一入口后来写入的提交。 */
export function clearCreationSubmission(key: string, id: string) {
  if (readCreationSubmission(key)?.id === id) sessionStorage.removeItem(key);
}
