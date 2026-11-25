import {
  createCustomerContact,
  createCustomerContactMethod,
  updateCustomerContact,
} from "@/request/customers";
import type {
  ContactFormDraft,
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

export function contactRequest(
  customerId: string,
  change: ContactChange,
  versionFrom?: CustomerContact
) {
  if (change.kind === "create")
    return createCustomerContact(customerId, change.draft, change.submission);

  const expectedVersion = (versionFrom ?? change.contact).version;
  if (change.kind === "add") {
    return createCustomerContactMethod(customerId, change.contact.id, {
      ...change.method,
      expectedVersion,
    });
  }
  return updateCustomerContact(customerId, change.contact.id, {
    ...change.draft,
    expectedVersion,
  });
}
