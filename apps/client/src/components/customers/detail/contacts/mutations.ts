import {
  createCustomerContact,
  createCustomerContactMethod,
  deleteCustomerContactMethod,
  restoreCustomerContactMethod,
  updateCustomerContact,
  updateCustomerContactMethod,
} from "@/request/customers";
import type {
  CustomerContact,
  CustomerContactMethod,
  CustomerContactMethodInput,
} from "@/request/customers";

export type ContactChange =
  | {
      kind: "create";
      name: string;
      method: CustomerContactMethodInput;
      submission: { id: string; accountId: string };
    }
  | {
      kind: "add";
      contact: CustomerContact;
      method: CustomerContactMethodInput;
    }
  | { kind: "rename"; contact: CustomerContact; name: string }
  | {
      kind: "edit";
      contact: CustomerContact;
      methodId: string;
      fields: Partial<CustomerContactMethodInput>;
    }
  | { kind: "delete"; contact: CustomerContact; method: CustomerContactMethod };

export type DeleteChange = Extract<ContactChange, { kind: "delete" }>;

export type ContactEditSnapshot =
  | { kind: "rename"; contact: CustomerContact }
  | { kind: "edit"; contact: CustomerContact; method: CustomerContactMethod };

/**
 * 根据操作类型调用对应的联系人或联系方式接口。
 * @param customerId 所属客户的 ID。
 * @param change 待执行的操作，已有联系人操作附带编辑时的记录快照。
 * @param versionFrom 已核对的最新联系人快照，省略时使用打开表单时的快照。新建联系人无需版本号。
 * @param requireCurrentVersion 写回旧值后的草稿保存须严格核对版本。
 * @returns 接口返回的 `{ contact }`，包含保存后的联系人及联系方式。
 * @throws 请求失败时传递接口错误或网络错误。
 */
export function contactRequest(
  customerId: string,
  change: ContactChange,
  versionFrom?: CustomerContact,
  requireCurrentVersion = false
) {
  if (change.kind === "create")
    return createCustomerContact(
      customerId,
      { name: change.name, methods: [change.method] },
      change.submission
    );

  const snapshot = versionFrom ?? change.contact;
  const expectedVersion = snapshot.version;
  const contactId = change.contact.id;
  switch (change.kind) {
    case "rename":
      return updateCustomerContact(customerId, contactId, {
        name: change.name,
        expectedVersion,
      });
    case "add":
      return createCustomerContactMethod(customerId, contactId, {
        ...change.method,
        expectedVersion,
      });
    case "edit": {
      const method = snapshot.methods.find(
        (item) => item.id === change.methodId
      );
      if (!method) throw new Error("该联系方式已被删除。");
      return updateCustomerContactMethod(
        customerId,
        contactId,
        change.methodId,
        {
          ...change.fields,
          expectedMethodVersion: method.version,
          expectedContactVersion:
            change.fields.isPrimary === undefined ? undefined : expectedVersion,
          requireCurrentVersion: requireCurrentVersion ? true : undefined,
        }
      );
    }
    case "delete":
      return deleteCustomerContactMethod(
        customerId,
        contactId,
        change.method.id,
        expectedVersion
      );
  }
}

/**
 * 用对比弹窗里的版本写回打开编辑时的旧资料。
 * @param customerId 所属客户的 ID。
 * @param original 打开编辑时保留的原始快照。
 * @param latest 已核对的远端快照，提供两级版本号。
 * @returns 接口返回的联系人快照，其中包含写回后的版本。
 * @throws 请求失败时传递接口错误或网络错误。
 */
export function restoreContactRequest(
  customerId: string,
  original: ContactEditSnapshot,
  latest: CustomerContact
) {
  if (original.kind === "rename")
    return updateCustomerContact(customerId, original.contact.id, {
      name: original.contact.name,
      expectedVersion: latest.version,
    });

  const { method, contact } = original;
  const current = latest.methods.find((item) => item.id === method.id);
  if (!current) throw new Error("该联系方式已被删除。");
  const primary = contact.methods.find((item) => item.isPrimary);
  if (!primary) throw new Error("无法确认编辑前的主要联系方式。");
  return restoreCustomerContactMethod(customerId, contact.id, method.id, {
    type: method.type,
    value: method.value,
    restorePrimaryMethodId: primary.id,
    expectedMethodVersion: current.version,
    expectedContactVersion: latest.version,
  });
}
