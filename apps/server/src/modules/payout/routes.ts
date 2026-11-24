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
} from "../customer/input";

import {
  payoutCreateFields,
  payoutPatchFields,
  readPayoutCreateInput,
  readPayoutPatch,
} from "./input";
import { getPayout, listPayouts } from "./queries";
import { archivePayout, createPayout, updatePayout } from "./records";

export const payoutRoutes = new Hono<BusinessAccessEnv>();

payoutRoutes.use("*", requireBusinessAccess);

payoutRoutes.get("/", async (c) => {
  const { page, pageSize, search } = c.req.query();
  const query = c.req.queries();
  const result = await listPayouts(c.get("businessAccess"), {
    products: readListOptionFilter(
      query.productId,
      query.productOperator,
      "产品",
      (value) => readUuid(value, "产品 ID")
    ),
    page: readPositiveInteger(page, "页码", 1, 1_000_000),
    pageSize: readPositiveInteger(pageSize, "每页条数", 20, 100),
    search: search?.trim() ? readString(search, "搜索词", 256) : undefined,
  });
  return c.json(result);
});

payoutRoutes.get("/:payoutId", async (c) => {
  const record = await getPayout(
    c.get("businessAccess"),
    readUuid(c.req.param("payoutId"), "Payout ID")
  );
  return c.json({ payout: record });
});

payoutRoutes.post("/", async (c) => {
  const body = await readObject(c, payoutCreateFields);
  const record = await createPayout(
    c.get("businessAccess"),
    readPayoutCreateInput(body),
    readUuid(c.req.header("Idempotency-Key"), "提交 ID")
  );
  return c.json({ payout: record }, 201);
});

payoutRoutes.patch("/:payoutId", async (c) => {
  const id = readUuid(c.req.param("payoutId"), "Payout ID");
  const body = await readObject(c, [...payoutPatchFields, "expectedVersion"]);
  const record = await updatePayout(
    c.get("businessAccess"),
    id,
    readPayoutPatch(body),
    readExpectedVersion(body.expectedVersion)
  );
  return c.json({ payout: record });
});

payoutRoutes.delete("/:payoutId", async (c) => {
  const version = c.req.query("expectedVersion");
  const record = await archivePayout(
    c.get("businessAccess"),
    readUuid(c.req.param("payoutId"), "Payout ID"),
    readExpectedVersion(
      version && /^\d+$/u.test(version) ? Number(version) : undefined
    )
  );
  return c.json({ payout: record });
});
