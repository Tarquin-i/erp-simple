import {
  createCustomerContact,
  createCustomerContactMethod,
  deleteCustomerContactMethod,
  updateCustomerContact,
  updateCustomerContactMethod,
} from "@/request/customers";
import type {
  CustomerContact,
  CustomerContactMethod,
  CustomerContactMethodInput,
} from "@/request/customers";

export type ContactChange =
  | { kind: "create"; name: string; method: CustomerContactMethodInput }
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

/**
 * 根据操作类型调用对应的联系人或联系方式接口。
 * @param customerId 所属客户的 ID。
 * @param change 待执行的操作，已有联系人操作附带编辑时的记录快照。
 * @param version 确认覆盖时传入的最新联系人版本，省略时用快照版本。新建联系人无需版本号。
 * @returns 接口返回的 `{ contact }`，包含保存后的联系人及联系方式。
 * @throws 请求失败时传递接口错误或网络错误。
 */
export function contactRequest(
  customerId: string,
  change: ContactChange,
  version?: number
) {
  if (change.kind === "create")
    return createCustomerContact(customerId, {
      name: change.name,
      methods: [change.method],
    });

  const expectedVersion = version ?? change.contact.version;
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
    case "edit":
      return updateCustomerContactMethod(
        customerId,
        contactId,
        change.methodId,
        { ...change.fields, expectedVersion }
      );
    case "delete":
      return deleteCustomerContactMethod(
        customerId,
        contactId,
        change.method.id,
        expectedVersion
      );
  }
}
