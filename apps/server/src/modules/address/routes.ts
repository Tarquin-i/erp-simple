import { Hono } from "hono";

import { requireBusinessAccess } from "../business/access";
import type { BusinessAccessEnv } from "../business/access";
import { readListOptionFilter } from "../business/list-option-filter";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../http/request-input";
import { fail } from "../organization/errors";

import {
  addressWriteFields,
  readAddressCreateInput,
  readAddressPatch,
} from "./input";
import {
  getAddress,
  listCustomerAddresses,
  listDefaultAddresses,
} from "./queries";
import { archiveAddress, createAddress, updateAddress } from "./records";

const createFields = [
  ...addressWriteFields,
  "customerId",
  "expectedDefault",
  "replaceExistingDefault",
];
const updateFields = [...addressWriteFields, "expectedVersion"];

function readExpectedDefault(value: unknown) {
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

function readPagination({ page, pageSize }: Record<string, string>) {
  return {
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
  };
}

export const addressRoutes = new Hono<BusinessAccessEnv>();

addressRoutes.use("*", requireBusinessAccess);

addressRoutes.get("/", async (c) => {
  const query = c.req.query();
  const { ownerUserId, ownerOperator } = c.req.queries();
  const result = await listDefaultAddresses(c.get("businessAccess"), {
    ...readPagination(query),
    search: query.search?.trim()
      ? readString(query.search, "搜索词", 128)
      : undefined,
    owners: readListOptionFilter(
      ownerUserId,
      ownerOperator,
      "业务员",
      (value) => readString(value, "业务员 ID", 128)
    ),
  });
  return c.json(result);
});

addressRoutes.post("/", async (c) => {
  const body = await readObject(c, createFields);
  // 兼容旧请求中的布尔字段，实际替换以确认的默认地址快照为准。
  const { replaceExistingDefault } = body;
  if (
    replaceExistingDefault !== undefined &&
    typeof replaceExistingDefault !== "boolean"
  ) {
    fail(400, "替换默认地址确认须为布尔值。");
  }
  const address = await createAddress(
    c.get("businessAccess"),
    readUuid(body.customerId, "客户 ID"),
    readAddressCreateInput(body),
    readExpectedDefault(body.expectedDefault),
    readUuid(c.req.header("Idempotency-Key"), "提交 ID")
  );
  return c.json({ address }, 201);
});

addressRoutes.get("/:addressId", async (c) => {
  const address = await getAddress(
    c.get("businessAccess"),
    readUuid(c.req.param("addressId"), "地址 ID")
  );
  return c.json({ address });
});

addressRoutes.patch("/:addressId", async (c) => {
  const addressId = readUuid(c.req.param("addressId"), "地址 ID");
  const body = await readObject(c, updateFields);
  const address = await updateAddress(
    c.get("businessAccess"),
    addressId,
    readAddressPatch(body),
    readExpectedVersion(body.expectedVersion)
  );
  return c.json({ address });
});

addressRoutes.delete("/:addressId", async (c) => {
  const addressId = readUuid(c.req.param("addressId"), "地址 ID");
  const version = c.req.query("expectedVersion");
  const address = await archiveAddress(
    c.get("businessAccess"),
    addressId,
    readExpectedVersion(
      version && /^\d+$/u.test(version) ? Number(version) : undefined
    )
  );
  return c.json({ address });
});

/** 挂到客户路由下，沿用客户路由的业务权限中间件。 */
export const customerAddressRoutes = new Hono<BusinessAccessEnv>();

customerAddressRoutes.get("/:customerId/addresses", async (c) => {
  const result = await listCustomerAddresses(
    c.get("businessAccess"),
    readUuid(c.req.param("customerId"), "客户 ID"),
    readPagination(c.req.query())
  );
  return c.json(result);
});
