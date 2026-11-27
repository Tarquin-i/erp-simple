import type { DatabaseTransaction } from "@repo/db";
import { communication } from "@repo/db/schema";

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
  }: {
    definition: SeedCustomerDefinition;
    offset: number;
    customerId: string;
    departmentId: string;
    ownerUserId: string;
    colleagueUserId: string;
    createdAt: Date;
    now: number;
  }
) {
  let createdCount = 0;
  for (const [step, template] of seedCommunicationTemplates.entries()) {
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
    if (createdCommunication) createdCount++;
  }

  return createdCount;
}
