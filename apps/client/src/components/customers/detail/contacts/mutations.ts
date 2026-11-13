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
