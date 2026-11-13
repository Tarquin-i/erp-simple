import {
  CustomerApiError,
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
  CustomerContactMethodType,
} from "@/request/customers";

export const contactMethodLabels: Record<CustomerContactMethodType, string> = {
  phone: "电话",
  email: "邮箱",
  wechat: "微信",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  kingwin_alibaba: "将为阿里巴巴",
  kingwin_international_station: "将为国际站",
  huivo_international_station: "汇合国际站",
};

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

type ExistingChange = Exclude<ContactChange, { kind: "create" }>;
export type DeleteChange = Extract<ContactChange, { kind: "delete" }>;
export type ContactConflict = {
  change: ExistingChange;
  latest: CustomerContact;
};

export function latestContact(error: unknown, contactId: string) {
  if (!(error instanceof CustomerApiError) || error.code !== "version_conflict")
    return;
  const current = error.current;
  if (
    current &&
    typeof current === "object" &&
    "id" in current &&
    current.id === contactId &&
    "version" in current &&
    typeof current.version === "number" &&
    "methods" in current &&
    Array.isArray(current.methods)
  )
    return current as CustomerContact;
}

export function conflictDifferences({ change, latest }: ContactConflict) {
  switch (change.kind) {
    case "rename":
      return [
        { label: "联系人姓名", current: latest.name, proposed: change.name },
      ];
    case "add":
      return [
        {
          label: contactMethodLabels[change.method.type],
          current: "未添加",
          proposed: change.method.value,
        },
      ];
    case "delete": {
      const method = latest.methods.find(
        (item) => item.id === change.method.id
      );
      return [
        {
          label: "待删除的联系方式",
          current: method
            ? `${contactMethodLabels[method.type]} · ${method.value}`
            : "已删除",
          proposed: "删除该联系方式",
        },
      ];
    }
    case "edit": {
      const current = latest.methods.find(
        (item) => item.id === change.methodId
      );
      if (!current) return [];
      const original =
        change.contact.methods.find((item) => item.id === change.methodId) ??
        current;
      const differences: {
        label: string;
        current: string;
        proposed: string;
      }[] = [];
      if (latest.name !== change.contact.name)
        differences.push({
          label: "联系人姓名",
          current: latest.name,
          proposed: "保留当前姓名",
        });
      if (change.fields.type !== undefined || current.type !== original.type)
        differences.push({
          label: "联系方式",
          current:
            current.type === original.type
              ? contactMethodLabels[current.type]
              : `${contactMethodLabels[current.type]}（原为${contactMethodLabels[original.type]}）`,
          proposed:
            change.fields.type === undefined
              ? "保留当前方式"
              : contactMethodLabels[change.fields.type],
        });
      if (change.fields.value !== undefined || current.value !== original.value)
        differences.push({
          label: "联系信息",
          current: current.value,
          proposed: change.fields.value ?? "保留当前联系信息",
        });
      if (
        change.fields.isPrimary !== undefined ||
        current.isPrimary !== original.isPrimary
      )
        differences.push({
          label: "主要联系方式",
          current: current.isPrimary ? "是" : "否",
          proposed:
            change.fields.isPrimary === undefined
              ? "保留当前设置"
              : change.fields.isPrimary
                ? "是"
                : "否",
        });
      return differences;
    }
  }
}

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
