import { Hono } from "hono";

import { fail } from "../../../errors";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import type {
  RecordAccessEnv,
  RecordAccessMiddleware,
} from "../../identity/http/record-access-context";
import type { AddressModule } from "../module";
import {
  addressCreateFields,
  addressPatchFields,
  readAddressCreateInput,
  readAddressPatch,
  readExpectedDefault,
} from "./write-requests";

function readPagination({ page, pageSize }: Record<string, string>) {
  return {
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
  };
}

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
function readOwnerFilter(
  values: string[] | undefined,
  operators: string[] | undefined
) {
  if (operators && operators.length > 1) {
    fail(400, "业务员筛选只接受一个运算符。");
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, "请选择要筛选的业务员。");
    return;
  }
  if (values.length > 100) fail(400, "业务员筛选最多接受 100 项。");
  const distinctValues = [
    ...new Set(values.map((value) => readString(value, "业务员 ID", 128))),
  ];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, "请选择与业务员所选项数量匹配的筛选运算符。");
  }
  return { values: distinctValues, excluded: operator === exclude };
}

export function createAddressRoutes(
  {
    listDefaultAddresses,
    getAddress,
    createAddress,
    updateAddress,
    archiveAddress,
  }: AddressModule["deliveryAddresses"],
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.use("*", requireRecordAccess);

  routes.get("/", async (c) => {
    const query = c.req.query();
    const { ownerUserId, ownerOperator } = c.req.queries();
    const result = await listDefaultAddresses(c.get("recordAccess"), {
      ...readPagination(query),
      search: query.search?.trim()
        ? readString(query.search, "搜索词", 128)
        : undefined,
      owners: readOwnerFilter(ownerUserId, ownerOperator),
    });
    return c.json(result);
  });

  routes.post("/", async (c) => {
    const body = await readObject(c, addressCreateFields);
    // 兼容旧请求中的布尔字段，实际替换以确认的默认地址快照为准。
    const { replaceExistingDefault } = body;
    if (
      replaceExistingDefault !== undefined &&
      typeof replaceExistingDefault !== "boolean"
    ) {
      fail(400, "替换默认地址确认须为布尔值。");
    }
    const address = await createAddress(
      c.get("recordAccess"),
      readUuid(body.customerId, "客户 ID"),
      readAddressCreateInput(body),
      readExpectedDefault(body.expectedDefault),
      readUuid(c.req.header("Idempotency-Key"), "提交 ID")
    );
    return c.json({ address }, 201);
  });

  routes.get("/:addressId", async (c) => {
    const address = await getAddress(
      c.get("recordAccess"),
      readUuid(c.req.param("addressId"), "地址 ID")
    );
    return c.json({ address });
  });

  routes.patch("/:addressId", async (c) => {
    const addressId = readUuid(c.req.param("addressId"), "地址 ID");
    const body = await readObject(c, addressPatchFields);
    const address = await updateAddress(
      c.get("recordAccess"),
      addressId,
      readAddressPatch(body),
      readExpectedVersion(body.expectedVersion)
    );
    return c.json({ address });
  });

  routes.delete("/:addressId", async (c) => {
    const addressId = readUuid(c.req.param("addressId"), "地址 ID");
    const version = c.req.query("expectedVersion");
    const address = await archiveAddress(
      c.get("recordAccess"),
      addressId,
      readExpectedVersion(
        version && /^\d+$/u.test(version) ? Number(version) : undefined
      )
    );
    return c.json({ address });
  });

  return routes;
}

/** 挂到客户路由下，沿用客户路由的业务权限中间件。 */
export function createCustomerAddressRoutes(
  listCustomerAddresses: AddressModule["deliveryAddresses"]["listCustomerAddresses"]
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.get("/:customerId/addresses", async (c) => {
    const result = await listCustomerAddresses(
      c.get("recordAccess"),
      readUuid(c.req.param("customerId"), "客户 ID"),
      readPagination(c.req.query())
    );
    return c.json(result);
  });

  return routes;
}
