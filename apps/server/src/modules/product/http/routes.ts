import { Hono } from "hono";

import type {
  RecordAccessEnv,
  RecordAccessMiddleware,
} from "../../identity/http/record-access-context";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import { fail } from "../../../errors";

import type { ProductModule } from "../module";
import {
  productWriteFields,
  readProductCreateInput,
  readProductPatch,
  readProductType,
} from "./write-requests";

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
function readListOptionFilter<T extends string>(
  values: string[] | undefined,
  operators: string[] | undefined,
  label: string,
  parse: (item: string) => T
) {
  if (operators && operators.length > 1) {
    fail(400, `${label}筛选只接受一个运算符。`);
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, `请选择要筛选的${label}。`);
    return;
  }
  if (values.length > 100) fail(400, `${label}筛选最多接受 100 项。`);
  const distinctValues = [...new Set(values.map(parse))];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, `请选择与${label}所选项数量匹配的筛选运算符。`);
  }
  return { values: distinctValues, excluded: operator === exclude };
}

export function createProductRoutes(
  {
    archiveProduct,
    createProduct,
    getProduct,
    listProducts,
    updateProduct,
  }: ProductModule["products"],
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.use("*", requireRecordAccess);

  routes.get("/", async (c) => {
    const { page, pageSize, search, sortDirection = "desc" } = c.req.query();
    if (sortDirection !== "asc" && sortDirection !== "desc") {
      fail(400, "请选择有效的产品排序方向。");
    }
    const query = c.req.queries();
    const typeValues = [
      ...(query.productTypes ?? []),
      ...(query.productType ?? []),
    ].flatMap((value) => value.split(","));
    if (typeValues.length > 20) fail(400, "最多可筛选 20 个产品类型。");

    const result = await listProducts(c.get("recordAccess"), {
      page: readPositiveInteger(page, "页码", 1, 1_000_000),
      pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
      search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
      customers: readListOptionFilter(
        query.customerId,
        query.customerOperator,
        "客户",
        (value) => readUuid(value, "客户 ID")
      ),
      productTypes: readListOptionFilter(
        typeValues,
        query.productTypeOperator,
        "产品类型",
        (value) => readProductType(value.trim())
      ),
      sortDirection,
    });
    return c.json(result);
  });

  routes.get("/:productId", async (c) => {
    const product = await getProduct(
      c.get("recordAccess"),
      readUuid(c.req.param("productId"), "产品 ID")
    );
    return c.json({ product });
  });

  routes.post("/", async (c) => {
    const body = await readObject(c, [...productWriteFields, "customerId"]);
    const product = await createProduct(
      c.get("recordAccess"),
      readProductCreateInput(body),
      readUuid(c.req.header("Idempotency-Key"), "提交 ID")
    );
    return c.json({ product }, 201);
  });

  routes.patch("/:productId", async (c) => {
    const id = readUuid(c.req.param("productId"), "产品 ID");
    const body = await readObject(c, [
      ...productWriteFields,
      "expectedVersion",
    ]);
    const product = await updateProduct(
      c.get("recordAccess"),
      id,
      readProductPatch(body),
      readExpectedVersion(body.expectedVersion)
    );
    return c.json({ product });
  });

  routes.delete("/:productId", async (c) => {
    const id = readUuid(c.req.param("productId"), "产品 ID");
    const version = c.req.query("expectedVersion");
    const product = await archiveProduct(
      c.get("recordAccess"),
      id,
      readExpectedVersion(
        version && /^\d+$/u.test(version) ? Number(version) : undefined
      )
    );
    return c.json({ product });
  });

  return routes;
}
