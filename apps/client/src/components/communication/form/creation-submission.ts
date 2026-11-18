import { createUuid } from "@/lib/uuid";
import {
  CommunicationApiError,
  createCommunication,
} from "@/request/communication";
import type {
  Communication,
  CreateCommunicationInput,
} from "@/request/communication";

type CreationSubmission = {
  key: string;
  id: string;
  input: CreateCommunicationInput;
};

type CreationResult =
  | { status: "saved"; communication: Communication }
  | { status: "rejected"; error: CommunicationApiError }
  | { status: "pending"; message: string }
  | { status: "ended" };

export type CreationRecovery = {
  submission: CreationSubmission;
  attempt?: Promise<CreationResult>;
  message?: string;
};

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const submissionChange = "communication-submission-change";
const readError = "无法读取本地提交记录。请恢复浏览器站点存储后重试。";
const attempts = new Map<string, Promise<CreationResult>>();

function creationStorageKey(accountId: string) {
  return "communication-submission:v2:" + JSON.stringify(accountId);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function parseCreationSubmission(key: string, raw: string): CreationSubmission {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error(readError);
  const { id, customerId, title, summary, ownerUserId, tags, tagIds } =
    value as Record<string, unknown>;

  // 旧版按入口保存完整标签选项，恢复时保留原请求中的标签 ID 及顺序。
  const ids =
    tagIds ??
    (Array.isArray(tags)
      ? tags.map((tag) => (tag && typeof tag === "object" ? tag.id : null))
      : null);
  if (
    !isUuid(id) ||
    !isUuid(customerId) ||
    typeof title !== "string" ||
    typeof summary !== "string" ||
    (ownerUserId !== undefined && typeof ownerUserId !== "string") ||
    !Array.isArray(ids) ||
    !ids.every(isUuid)
  ) {
    throw new Error(readError);
  }

  return {
    key,
    id,
    input: { customerId, title, summary, ownerUserId, tagIds: ids },
  };
}

/**
 * 读取当前账号在本标签页的待确认提交，兼容旧版按入口暂存的提交。
 * @param accountId 当前登录账号。
 * @returns 原始提交和暂存位置，或无待确认提交时的 null。
 * @throws 本地存储不可用或数据不可读时抛出错误。
 */
function readCreationSubmission(accountId: string): CreationSubmission | null {
  try {
    const key = creationStorageKey(accountId);
    const raw = sessionStorage.getItem(key);
    if (raw !== null) return parseCreationSubmission(key, raw);

    const legacyPrefix =
      "communication-submission:v1:[" + JSON.stringify(accountId) + ",";
    for (let index = 0; index < sessionStorage.length; index++) {
      const legacyKey = sessionStorage.key(index);
      if (!legacyKey?.startsWith(legacyPrefix)) continue;
      const legacy = sessionStorage.getItem(legacyKey);
      if (legacy !== null) return parseCreationSubmission(legacyKey, legacy);
    }
    return null;
  } catch {
    // 恢复记录不可读时不另起一次提交，以免重复新建。
    throw new Error(readError);
  }
}

/**
 * 发送前暂存原请求，并通知已挂载的沟通列表。
 * @param accountId 当前登录账号。
 * @param input 提交时确定的客户、业务员、正文及标签。
 * @returns 含新提交 ID 的原始请求。
 * @throws 本地存储不可用时抛出错误，由调用方停止发送。
 */
function storeCreationSubmission(
  accountId: string,
  input: CreateCommunicationInput
): CreationSubmission {
  const key = creationStorageKey(accountId);
  const id = createUuid();
  const original = { ...input, tagIds: input.tagIds ?? [] };
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...original, id }));
  } catch {
    throw new Error(
      "无法保留本地提交记录，尚未发送请求。请恢复浏览器站点存储后重试。"
    );
  }

  window.dispatchEvent(new Event(submissionChange));
  return { key, id, input: original };
}

/** 按提交 ID 清除已处理的本地记录，避免影响随后写入的提交。 */
export function clearCreationSubmission({ key, id }: CreationSubmission) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null || parseCreationSubmission(key, raw).id !== id)
      return false;

    sessionStorage.removeItem(key);
    window.dispatchEvent(new Event(submissionChange));
    return true;
  } catch {
    throw new Error("无法清理本地提交记录。请恢复浏览器站点存储后重试。");
  }
}

function attemptKey(accountId: string, id: string) {
  return JSON.stringify([accountId, id]);
}

/** 读取待确认提交及可能仍在途的请求，换入口时可以继续等待同一个结果。 */
export function readCreationRecovery(
  accountId: string
): CreationRecovery | undefined {
  const submission = readCreationSubmission(accountId);
  if (!submission) return undefined;

  return {
    submission,
    attempt: attempts.get(attemptKey(accountId, submission.id)),
  };
}

function canEditAfterRejection(
  failure: unknown
): failure is CommunicationApiError {
  return (
    failure instanceof CommunicationApiError &&
    failure.status >= 400 &&
    failure.status < 500 &&
    failure.status !== 408 &&
    failure.status !== 429 &&
    failure.code !== "idempotency_conflict"
  );
}

function pendingResult(failure: unknown): CreationResult {
  if (failure instanceof CommunicationApiError) {
    return {
      status: "pending",
      message: [401, 403, 404].includes(failure.status)
        ? "当前无法继续确认这笔提交。你可以返回列表或结束本次确认。"
        : failure.message,
    };
  }
  return { status: "pending", message: "暂时无法确认保存结果，请重试原提交。" };
}

async function settleCreation(
  accountId: string,
  submission: CreationSubmission,
  firstAttempt: boolean
): Promise<CreationResult> {
  let outcome: CreationResult;
  try {
    const raw = sessionStorage.getItem(submission.key);
    if (
      raw === null ||
      parseCreationSubmission(submission.key, raw).id !== submission.id
    ) {
      return { status: "ended" };
    }
    const { communication } = await createCommunication(
      submission.input,
      submission.id,
      accountId
    );
    outcome = { status: "saved", communication };
  } catch (failure) {
    // 只有首次发送的明确拒绝才恢复普通编辑，重试拒绝仍保留原提交。
    if (!firstAttempt || !canEditAfterRejection(failure))
      return pendingResult(failure);
    outcome = { status: "rejected", error: failure };
  }

  try {
    // 若用户已结束此次确认，迟到响应不能影响后来暂存的请求。
    return clearCreationSubmission(submission) ? outcome : { status: "ended" };
  } catch (failure) {
    return {
      status: "pending",
      message:
        failure instanceof Error ? failure.message : "无法清理本地提交记录。",
    };
  }
}

/** 首次保存与恢复共用请求，同一账号和提交 ID 同时只有一次发送。 */
export function sendCreationSubmission(
  accountId: string,
  submission: CreationSubmission,
  firstAttempt = false
): Promise<CreationResult> {
  const key = attemptKey(accountId, submission.id);
  const running = attempts.get(key);
  if (running) return running;

  const attempt = Promise.resolve()
    .then(() => settleCreation(accountId, submission, firstAttempt))
    .finally(() => attempts.delete(key));
  attempts.set(key, attempt);
  return attempt;
}

/** 暂存一笔新请求并发送，已有待确认提交时交给恢复页。 */
export function startCreationSubmission(
  accountId: string,
  input: CreateCommunicationInput
) {
  const recovery = readCreationRecovery(accountId);
  if (recovery) return { recovery };

  const submission = storeCreationSubmission(accountId, input);
  return {
    submission,
    attempt: sendCreationSubmission(accountId, submission, true),
  };
}

export function hasPendingCreation(accountId: string) {
  try {
    return readCreationSubmission(accountId) !== null;
  } catch {
    return false;
  }
}

export function subscribeToCreationSubmissions(listener: () => void) {
  window.addEventListener(submissionChange, listener);
  return () => window.removeEventListener(submissionChange, listener);
}
