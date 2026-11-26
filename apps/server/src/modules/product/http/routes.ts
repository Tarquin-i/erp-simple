import { Hono } from "hono";

import { requireBusinessAccess } from "../../business/access";
import type { BusinessAccessEnv } from "../../business/access";
import { readListOptionFilter } from "../../business/list-option-filter";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../../../http/request-input";
import { fail } from "../../organization/errors";

import type { ProductModule } from "../module";
import {
  productWriteFields,
  readProductCreateInput,
  readProductPatch,
  readProductType,
} from "./write-requests";

export function createProductRoutes({
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
}: ProductModule["products"]) {
  const routes = new Hono<BusinessAccessEnv>();

  routes.use("*", requireBusinessAccess);

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

    const result = await listProducts(c.get("businessAccess"), {
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
      c.get("businessAccess"),
      readUuid(c.req.param("productId"), "产品 ID")
    );
    return c.json({ product });
  });

  routes.post("/", async (c) => {
    const body = await readObject(c, [...productWriteFields, "customerId"]);
    const product = await createProduct(
      c.get("businessAccess"),
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
      c.get("businessAccess"),
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
      c.get("businessAccess"),
      id,
      readExpectedVersion(
        version && /^\d+$/u.test(version) ? Number(version) : undefined
      )
    );
    return c.json({ product });
  });

  return routes;
}
