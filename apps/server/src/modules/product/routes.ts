import { Hono } from "hono";

import { requireBusinessAccess } from "../business/access";
import type { BusinessAccessEnv } from "../business/access";
import {
  readExpectedVersion,
  readObject,
  readPositiveInteger,
  readString,
  readUuid,
} from "../customer/input";
import { fail } from "../organization/errors";

import {
  productWriteFields,
  readProductCreateInput,
  readProductPatch,
  readProductType,
} from "./input";
import { getProduct, listProducts } from "./queries";
import { archiveProduct, createProduct, updateProduct } from "./records";

export const productRoutes = new Hono<BusinessAccessEnv>();

productRoutes.use("*", requireBusinessAccess);

productRoutes.get("/", async (c) => {
  const {
    page,
    pageSize,
    search,
    customerId,
    sortDirection = "desc",
  } = c.req.query();
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    fail(400, "请选择有效的产品排序方向。");
  }
  const typeValues = [
    ...(c.req.queries("productTypes") ?? []),
    ...(c.req.queries("productType") ?? []),
  ].flatMap((value) => value.split(","));
  if (typeValues.length > 20) fail(400, "最多可筛选 20 个产品类型。");

  const result = await listProducts(c.get("businessAccess"), {
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
    search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
    customerId:
      customerId === undefined ? undefined : readUuid(customerId, "客户 ID"),
    productTypes: [
      ...new Set(typeValues.map((value) => readProductType(value.trim()))),
    ],
    sortDirection,
  });
  return c.json(result);
});

productRoutes.get("/:productId", async (c) => {
  const product = await getProduct(
    c.get("businessAccess"),
    readUuid(c.req.param("productId"), "产品 ID")
  );
  return c.json({ product });
});

productRoutes.post("/", async (c) => {
  const body = await readObject(c, [...productWriteFields, "customerId"]);
  const product = await createProduct(
    c.get("businessAccess"),
    readProductCreateInput(body),
    readUuid(c.req.header("Idempotency-Key"), "提交 ID")
  );
  return c.json({ product }, 201);
});

productRoutes.patch("/:productId", async (c) => {
  const id = readUuid(c.req.param("productId"), "产品 ID");
  const body = await readObject(c, [...productWriteFields, "expectedVersion"]);
  const product = await updateProduct(
    c.get("businessAccess"),
    id,
    readProductPatch(body),
    readExpectedVersion(body.expectedVersion)
  );
  return c.json({ product });
});

productRoutes.delete("/:productId", async (c) => {
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
