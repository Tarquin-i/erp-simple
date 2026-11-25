import {
  createCustomerContact,
  createCustomerContactMethod,
  updateCustomerContact,
} from "@/request/customers";
import type {
  ContactFormDraft,
  ContactMethodChanges,
  CustomerContact,
  CustomerContactMethodInput,
} from "@/request/customers";

export type ContactChange =
  | {
      kind: "create";
      draft: ContactFormDraft;
      submission: { id: string; accountId: string };
    }
  | { kind: "edit"; contact: CustomerContact; draft: ContactFormDraft }
  | {
      kind: "add";
      contact: CustomerContact;
      method: CustomerContactMethodInput;
    };

function getMethodChanges(
  current: CustomerContact["methods"],
  draft: ContactFormDraft["methods"]
): ContactMethodChanges {
  const existing = new Map(current.map((method) => [method.id, method]));
  const add: NonNullable<ContactMethodChanges["add"]> = [];
  const update: NonNullable<ContactMethodChanges["update"]> = [];

  for (const { id, type, value, isPrimary } of draft) {
    if (!id) {
      add.push({ type, value, isPrimary });
      continue;
    }

    const before = existing.get(id);
    if (!before) throw new Error("联系方式已更新，请重新打开编辑窗口后重试。");
    existing.delete(id);
    const changedType = before.type !== type;
    const changedValue = before.value !== value;
    const changedPrimary = before.isPrimary !== isPrimary;
    if (changedType || changedValue || changedPrimary) {
      update.push({
        id,
        ...(changedType && { type }),
        ...(changedValue && { value }),
        ...(changedPrimary && { isPrimary }),
      });
    }
  }

  return {
    ...(add.length && { add }),
    ...(update.length && { update }),
    ...(existing.size && { remove: [...existing.keys()] }),
  };
}

export function contactRequest(
  customerId: string,
  change: ContactChange,
  versionFrom?: CustomerContact
) {
  if (change.kind === "create")
    return createCustomerContact(customerId, change.draft, change.submission);

  const current = versionFrom ?? change.contact;
  const expectedVersion = current.version;
  if (change.kind === "add") {
    return createCustomerContactMethod(customerId, change.contact.id, {
      ...change.method,
      expectedVersion,
    });
  }
  const name =
    change.draft.name === current.name ? undefined : change.draft.name;
  const methodChanges = getMethodChanges(current.methods, change.draft.methods);
  return updateCustomerContact(
    customerId,
    change.contact.id,
    name !== undefined && Object.keys(methodChanges).length === 0
      ? { name, expectedVersion }
      : { name, expectedVersion, methodChanges }
  );
}
