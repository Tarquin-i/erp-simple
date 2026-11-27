import type { DatabaseTransaction } from "@repo/db";
import { communication, communicationTagAssignment } from "@repo/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import {
  seedCommunicationStatuses,
  seedCommunicationTemplates,
} from "./communication-definitions";
import type { SeedCustomerDefinition } from "./customer-definitions";
import { seedId } from "./seed-ids";

export async function seedCustomerCommunications(
  tx: DatabaseTransaction,
  {
    definition,
    offset,
    customerId,
    departmentId,
    ownerUserId,
    colleagueUserId,
    createdAt,
    now,
    tagIds,
  }: {
    definition: SeedCustomerDefinition;
    offset: number;
    customerId: string;
    departmentId: string;
    ownerUserId: string;
    colleagueUserId: string;
    createdAt: Date;
    now: number;
    tagIds: readonly string[];
  }
) {
  let createdCount = 0;
  for (const [step, template] of seedCommunicationTemplates.entries()) {
    const tagId = tagIds[step];
    if (!tagId) throw new Error("缺少演示沟通标签。");
    const communicationId = seedId("communication", offset * 2 + step + 1);
    const [createdCommunication] = await tx
      .insert(communication)
      .values({
        id: communicationId,
        customerId,
        departmentId,
        ownerUserId: step === 0 ? ownerUserId : colleagueUserId,
        title: `${definition.companyName}｜${template.subject}`,
        summary: template.summary(definition),
        status:
          seedCommunicationStatuses[
            (offset + step) % seedCommunicationStatuses.length
          ],
        createdAt,
        updatedAt: new Date(now - (offset * 2 + step) * 3600000),
      })
      .onConflictDoNothing({ target: communication.id })
      .returning({ id: communication.id });
    if (createdCommunication) {
      createdCount++;
    } else {
      // 旧种子只补未编辑、未归档且尚无标签的记录。
      const [existing] = await tx
        .select({ id: communication.id })
        .from(communication)
        .where(
          and(
            eq(communication.id, communicationId),
            eq(communication.customerId, customerId),
            eq(communication.departmentId, departmentId),
            eq(communication.version, 1),
            isNull(communication.archiveStartedAt),
            isNull(communication.archivedAt)
          )
        )
        .for("update");
      if (!existing) continue;
      const [assignment] = await tx
        .select({ tagId: communicationTagAssignment.tagId })
        .from(communicationTagAssignment)
        .where(eq(communicationTagAssignment.communicationId, communicationId))
        .limit(1);
      if (assignment) continue;
      await tx
        .update(communication)
        .set({ version: 2, updatedAt: communication.updatedAt })
        .where(eq(communication.id, communicationId));
    }

    await tx
      .insert(communicationTagAssignment)
      .values({ communicationId, tagId });
  }

  return createdCount;
}
