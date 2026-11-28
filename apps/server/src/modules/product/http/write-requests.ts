import { fail } from "../../../errors";
import { readUuid } from "../../../http/request-input";

import { failInvalidProductTypeFields } from "../application/errors";
import {
  prepareProductCreateFields,
  prepareProductPatch,
  prepareProductType,
  ProductFieldsError,
} from "../domain/product-fields";
import type {
  ProductCreateInput,
  ProductPatch,
  ProductType,
} from "../domain/type-fields";

export { productWriteFields } from "../domain/product-fields";

function readProductInput<T>(read: () => T) {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof ProductFieldsError)) throw error;
    if ("typeFields" in error.issue) {
      failInvalidProductTypeFields(error.issue.typeFields);
    }
    fail(400, error.issue.message);
  }
}

/** 校验产品类型代码，供列表筛选和写入共用。 */
export function readProductType(value: unknown): ProductType {
  return readProductInput(() => prepareProductType(value));
}

export function readProductCreateInput(
  body: Record<string, unknown>
): ProductCreateInput {
  const fields = readProductInput(() => prepareProductCreateFields(body));
  return { customerId: readUuid(body.customerId, "客户 ID"), ...fields };
}

export function readProductPatch(body: Record<string, unknown>): ProductPatch {
  return readProductInput(() => prepareProductPatch(body));
}
