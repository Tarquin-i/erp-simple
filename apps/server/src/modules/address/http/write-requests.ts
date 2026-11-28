import { fail } from "../../../errors";
import { readExpectedVersion, readUuid } from "../../../http/request-input";
import { createAddressError } from "../application/errors";
import {
  InvalidDeliveryAddressFields,
  prepareDeliveryAddressCreateFields,
  prepareDeliveryAddressFields,
} from "../domain/delivery-address-fields";

const addressWriteFields = [
  "recipientName",
  "phone",
  "countryCode",
  "province",
  "city",
  "district",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "remark",
  "isDefault",
] as const;

function readAddressFields<T>(prepare: () => T): T {
  try {
    return prepare();
  } catch (error) {
    if (!(error instanceof InvalidDeliveryAddressFields)) throw error;
    if (error.reason === "invalidPostalCode")
      throw createAddressError(error.reason);
    return fail(400, error.message);
  }
}

export function readAddressCreateInput(body: Record<string, unknown>) {
  return readAddressFields(() => prepareDeliveryAddressCreateFields(body));
}

export function readAddressPatch(body: Record<string, unknown>) {
  const patch = readAddressFields(() => prepareDeliveryAddressFields(body));
  if (!Object.keys(patch).length) fail(400, "请提交需要更新的地址资料。");
  return patch;
}

export const addressCreateFields = [
  ...addressWriteFields,
  "customerId",
  "expectedDefault",
  "replaceExistingDefault",
];
export const addressPatchFields = [...addressWriteFields, "expectedVersion"];

export function readExpectedDefault(value: unknown) {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "id" && key !== "version")
  ) {
    fail(400, "请提交有效的默认地址及版本。");
  }
  const { id, version } = value as Record<string, unknown>;
  return {
    id: readUuid(id, "默认地址 ID"),
    version: readExpectedVersion(version),
  };
}
