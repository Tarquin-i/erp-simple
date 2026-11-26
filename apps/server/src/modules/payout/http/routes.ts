import { Hono } from "hono";

import { fail } from "../../../errors";
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
import type { PayoutModule } from "../module";

import {
  payoutCreateFields,
  payoutPatchFields,
  readPayoutCreateInput,
  readPayoutPatch,
} from "./write-requests";

/** 校验列表筛选参数，去重后按不同选项数校验运算符。省略运算符时包含所选项。 */
function readProductFilter(
  values: string[] | undefined,
  operators: string[] | undefined
) {
  if (operators && operators.length > 1) {
    fail(400, "产品筛选只接受一个运算符。");
  }
  const operator = operators?.[0];
  if (!values?.length) {
    if (operator !== undefined) fail(400, "请选择要筛选的产品。");
    return;
  }
  if (values.length > 100) fail(400, "产品筛选最多接受 100 项。");
  const distinctValues = [
    ...new Set(values.map((value) => readUuid(value, "产品 ID"))),
  ];
  const multiple = distinctValues.length > 1;
  const include = multiple ? "is any of" : "is";
  const exclude = multiple ? "is none of" : "is not";
  if (operator !== undefined && operator !== include && operator !== exclude) {
    fail(400, "请选择与产品所选项数量匹配的筛选运算符。");
  }
  return { values: distinctValues, excluded: operator === exclude };
}

export function createPayoutRoutes(
  {
    archivePayout,
    createPayout,
    getPayout,
    listPayouts,
    updatePayout,
  }: PayoutModule["payouts"],
  requireRecordAccess: RecordAccessMiddleware
) {
  const routes = new Hono<RecordAccessEnv>();

  routes.use("*", requireRecordAccess);

  routes.get("/", async (c) => {
    const { page, pageSize, search } = c.req.query();
    const query = c.req.queries();
    const result = await listPayouts(c.get("recordAccess"), {
      products: readProductFilter(query.productId, query.productOperator),
      page: readPositiveInteger(page, "页码", 1, 1_000_000),
      pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
      search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
    });
    return c.json(result);
  });

  routes.get("/:payoutId", async (c) => {
    const record = await getPayout(
      c.get("recordAccess"),
      readUuid(c.req.param("payoutId"), "Payout ID")
    );
    return c.json({ payout: record });
  });

  routes.post("/", async (c) => {
    const body = await readObject(c, payoutCreateFields);
    const record = await createPayout(
      c.get("recordAccess"),
      readPayoutCreateInput(body),
      readUuid(c.req.header("Idempotency-Key"), "提交 ID")
    );
    return c.json({ payout: record }, 201);
  });

  routes.patch("/:payoutId", async (c) => {
    const id = readUuid(c.req.param("payoutId"), "Payout ID");
    const body = await readObject(c, [...payoutPatchFields, "expectedVersion"]);
    const record = await updatePayout(
      c.get("recordAccess"),
      id,
      readPayoutPatch(body),
      readExpectedVersion(body.expectedVersion)
    );
    return c.json({ payout: record });
  });

  routes.delete("/:payoutId", async (c) => {
    const version = c.req.query("expectedVersion");
    const record = await archivePayout(
      c.get("recordAccess"),
      readUuid(c.req.param("payoutId"), "Payout ID"),
      readExpectedVersion(
        version && /^\d+$/u.test(version) ? Number(version) : undefined
      )
    );
    return c.json({ payout: record });
  });
  return routes;
}
