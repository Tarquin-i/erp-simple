import type { DatabaseTransaction } from "@repo/db";
import {
  customer,
  customerChannel,
  customerChannelAssignment,
  customerContact,
  customerContactMethod,
  customerTagAssignment,
  member,
  user,
} from "@repo/db/schema";
import { eq, inArray } from "drizzle-orm";

import type { DepartmentKey } from "./account-definitions";
import { seedCustomerAddresses } from "./addresses";
import { seedCustomerCommunications } from "./communications";
import {
  createSeedContactMethods,
  seedCustomerChannels,
  seedCustomerDefinitions,
} from "./customer-definitions";
import type { DepartmentSeedTagIds } from "./department-tags";
import { seedCustomerProducts } from "./products";
import { seedId } from "./seed-ids";

export async function seedCustomers(
  tx: DatabaseTransaction,
  departmentIds: ReadonlyMap<DepartmentKey, string>,
  tagIdsByDepartment: ReadonlyMap<DepartmentKey, DepartmentSeedTagIds>
) {
  const createdChannels = await tx
    .insert(customerChannel)
    .values(seedCustomerChannels)
    .onConflictDoNothing({ target: customerChannel.code })
    .returning({ code: customerChannel.code });

  const owners = await tx
    .select({
      id: user.id,
      email: user.email,
      departmentId: member.organizationId,
    })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(
      inArray(user.email, ["a1@e.test", "a2@e.test", "b1@e.test", "b2@e.test"])
    );
  const ownerByLogin = new Map(
    owners.map((row) => [row.email.split("@")[0], row])
  );
  const now = Date.now();
  let createdCustomers = 0;
  let createdCommunications = 0;
  let createdAddresses = 0;
  let createdProducts = 0;
  for (const [offset, definition] of seedCustomerDefinitions.entries()) {
    const index = offset + 1;
    const departmentId = departmentIds.get(definition.department);
    const tagIds = tagIdsByDepartment.get(definition.department);
    const owner = ownerByLogin.get(definition.owner);
    const colleague = ownerByLogin.get(
      definition.owner.endsWith("1")
        ? `${definition.department}2`
        : `${definition.department}1`
    );
    if (
      !departmentId ||
      owner?.departmentId !== departmentId ||
      colleague?.departmentId !== departmentId
    ) {
      throw new Error(
        `种子业务员 ${definition.owner} 及同部门同事的部门配置不正确。`
      );
    }
    if (!tagIds) throw new Error(`缺少部门 ${departmentId} 的种子标签。`);
    const customerId = seedId("customer", index);
    const createdAt = new Date(now - index * 86400000);
    const customerFields = {
      id: customer.id,
      departmentId: customer.departmentId,
      ownerUserId: customer.ownerUserId,
      status: customer.status,
      version: customer.version,
      createdAt: customer.createdAt,
    };
    const [created] = await tx
      .insert(customer)
      .values({
        id: customerId,
        companyName: definition.companyName,
        departmentId,
        ownerUserId: owner.id,
        remark: definition.remark,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: customer.id })
      .returning(customerFields);
    const [record] = created
      ? [created]
      : await tx
          .select(customerFields)
          .from(customer)
          .where(eq(customer.id, customerId))
          .for("update");
    if (!record || record.departmentId !== departmentId) {
      throw new Error(`客户种子标识 ${customerId} 的部门不匹配。`);
    }
    if (record.status === "archived") continue;
    // 旧版种子只建了标签。只补齐尚未编辑且没有标签的演示客户。
    const existingTags =
      !created && record.version === 1
        ? await tx
            .select({ id: customerTagAssignment.tagId })
            .from(customerTagAssignment)
            .where(eq(customerTagAssignment.customerId, customerId))
            .limit(1)
        : [];
    if (created || (record.version === 1 && existingTags.length === 0)) {
      await tx.insert(customerTagAssignment).values({
        customerId,
        tagId: tagIds.customers[offset % tagIds.customers.length],
      });
      if (!created) {
        await tx
          .update(customer)
          .set({ updatedAt: customer.updatedAt, version: record.version + 1 })
          .where(eq(customer.id, customerId));
      }
    }
    createdProducts += await seedCustomerProducts(tx, index, record);
    createdAddresses += await seedCustomerAddresses(
      tx,
      customerId,
      index,
      createdAt
    );
    if (created) {
      createdCustomers++;
      await tx
        .insert(customerChannelAssignment)
        .values(
          (definition.department === "a"
            ? ["huivo_international_station", "huivo_alibaba"]
            : ["kingwin_international_station", "kingwin_alibaba"]
          ).map((channelCode) => ({ customerId, channelCode }))
        );
      const contactId = seedId("contact", index);
      await tx
        .insert(customerContact)
        .values({ id: contactId, customerId, name: definition.contact });
      const methods = createSeedContactMethods(index);
      await tx.insert(customerContactMethod).values(
        methods.map((method, methodIndex) => ({
          ...method,
          id: seedId("method", index * 10 + methodIndex),
          contactId,
        }))
      );
    }

    createdCommunications += await seedCustomerCommunications(tx, {
      definition,
      offset,
      customerId,
      departmentId,
      tagIds: tagIds.communications,
      ownerUserId: owner.id,
      colleagueUserId: colleague.id,
      createdAt,
      now,
    });
  }
  return {
    createdChannels: createdChannels.length,
    createdCustomers,
    createdCommunications,
    createdAddresses,
    createdProducts,
  };
}
