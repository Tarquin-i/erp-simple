import { customerPath, queryString, request, write } from "./client";

export type CustomerContactMethodType =
  | "phone"
  | "email"
  | "wechat"
  | "whatsapp"
  | "linkedin"
  | "kingwin_alibaba"
  | "kingwin_international_station"
  | "huivo_international_station";

export type CustomerContactMethodInput = {
  type: CustomerContactMethodType;
  value: string;
  isPrimary?: boolean;
};

export type ContactFormDraft = {
  name: string;
  methods: (CustomerContactMethodInput & { id?: string; isPrimary: boolean })[];
};

export type ContactMethodChanges = {
  add?: Omit<ContactFormDraft["methods"][number], "id">[];
  update?: (Partial<CustomerContactMethodInput> & { id: string })[];
  remove?: string[];
};

export type CustomerContactMethod = CustomerContactMethodInput & {
  id: string;
  contactId: string;
  isPrimary: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerContact = {
  id: string;
  customerId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  methods: CustomerContactMethod[];
};

const contactsPath = (customerId: string) =>
  `${customerPath(customerId)}/contacts`;
const contactPath = (customerId: string, contactId: string) =>
  `${contactsPath(customerId)}/${encodeURIComponent(contactId)}`;

export function listCustomerContacts(customerId: string, signal?: AbortSignal) {
  return request<{ contacts: CustomerContact[] }>(contactsPath(customerId), {
    signal,
  });
}

/**
 * 一并提交新联系人和首批联系方式，断线重试时复用原提交标识。
 * @param customerId 所属客户 ID。
 * @param input 联系人姓名和至少一条联系方式，可包含多个不同的邮箱。
 * @param submission 原提交 ID 和创建人账号 ID。
 * @returns `{ contact }`，包含新建或已提交的联系人及其联系方式。
 * @throws HTTP 失败时抛出 `CustomerApiError`，同一提交 ID 用于不同内容时为 409。
 */
export function createCustomerContact(
  customerId: string,
  input: { name: string; methods: CustomerContactMethodInput[] },
  submission: { id: string; accountId: string }
) {
  return request<{ contact: CustomerContact }>(contactsPath(customerId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": submission.id,
      "X-Expected-Account-Id": submission.accountId,
    },
    body: JSON.stringify(input),
  });
}

/**
 * 按版本保存联系人姓名、联系方式的变更或整组联系方式。
 * @param customerId 所属客户 ID。
 * @param contactId 待更新的联系人 ID。
 * @param input 联系人版本 `expectedVersion` 以及姓名或联系方式变更。
 * 整组 `methods` 和 `methodChanges` 每次只允许提交其中一种。
 * @returns `{ contact }`，包含更新后的联系人、联系方式和版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function updateCustomerContact(
  customerId: string,
  contactId: string,
  input: { expectedVersion: number } & (
    | {
        name: string;
        methods?: ContactFormDraft["methods"];
        methodChanges?: never;
      }
    | { name?: string; methodChanges: ContactMethodChanges; methods?: never }
  )
) {
  return write<{ contact: CustomerContact }>(
    contactPath(customerId, contactId),
    "PATCH",
    input
  );
}

export function archiveCustomerContact(
  customerId: string,
  contactId: string,
  expectedVersion: number
) {
  return request<{
    contact: { id: string; version: number; archivedAt: string };
  }>(
    `${contactPath(customerId, contactId)}${queryString({ expectedVersion })}`,
    {
      method: "DELETE",
    }
  );
}

/**
 * 为已有联系人添加一种联系方式。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param input 联系方式字段和联系人版本 `expectedVersion`。
 * @returns `{ contact }`，包含更新后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，包括联系方式重复或版本冲突。
 */
export function createCustomerContactMethod(
  customerId: string,
  contactId: string,
  input: CustomerContactMethodInput & { expectedVersion: number }
) {
  return write<{ contact: CustomerContact }>(
    `${contactPath(customerId, contactId)}/methods`,
    "POST",
    input
  );
}

/**
 * 提交一条联系方式的部分更新。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param methodId 要修改的联系方式 ID。
 * @param input 变更字段和联系方式版本 `expectedMethodVersion`。变更主要标记时还需附上联系人版本 `expectedContactVersion`。
 * @returns `{ contact }`，包含更新后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function updateCustomerContactMethod(
  customerId: string,
  contactId: string,
  methodId: string,
  input: Partial<CustomerContactMethodInput> & {
    expectedMethodVersion: number;
    expectedContactVersion?: number;
    requireCurrentVersion?: true;
  }
) {
  return write<{ contact: CustomerContact }>(
    `${contactPath(customerId, contactId)}/methods/${encodeURIComponent(methodId)}`,
    "PATCH",
    input
  );
}

/**
 * 按弹窗展示的版本写回一条联系方式的旧值和原主要项。
 * @param customerId 所属客户 ID。
 * @param contactId 所属联系人 ID。
 * @param methodId 要写回的联系方式 ID。
 * @param input 打开表单时的旧类型、旧值、原主要项 ID，以及此次核对过的两个版本。
 * @returns 写回后提交成功的联系人快照，供下次保存草稿使用。
 * @throws 请求失败时抛出 `CustomerApiError`，版本失配时带最新联系人快照。
 */
export function restoreCustomerContactMethod(
  customerId: string,
  contactId: string,
  methodId: string,
  input: Pick<CustomerContactMethodInput, "type" | "value"> & {
    restorePrimaryMethodId: string;
    expectedMethodVersion: number;
    expectedContactVersion: number;
  }
) {
  return write<{ contact: CustomerContact }>(
    `${contactPath(customerId, contactId)}/methods/${encodeURIComponent(methodId)}`,
    "PATCH",
    input
  );
}

/**
 * 删除一条联系方式，将联系人版本通过查询参数提交。
 * @param customerId 所属客户 ID。
 * @param contactId 联系人 ID。
 * @param methodId 要删除的联系方式 ID。
 * @param expectedVersion 提交所依据的联系人版本。
 * @returns `{ contact }`，包含删除后的联系方式列表和联系人版本。
 * @throws HTTP 失败时抛出 `CustomerApiError`，版本冲突时 `current` 包含最新联系人快照。
 */
export function deleteCustomerContactMethod(
  customerId: string,
  contactId: string,
  methodId: string,
  expectedVersion: number
) {
  const path = `${contactPath(customerId, contactId)}/methods/${encodeURIComponent(methodId)}`;
  return request<{ contact: CustomerContact }>(
    `${path}${queryString({ expectedVersion })}`,
    { method: "DELETE" }
  );
}
