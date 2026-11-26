import type { DatabaseTransaction } from "@repo/db";
import {
  communication,
  communicationTag,
  communicationTagAssignment,
} from "@repo/db/schema";
import { inArray, or } from "drizzle-orm";

import {
  seedCommunicationStatuses,
  seedCommunicationTags,
  seedCommunicationTemplates,
} from "./communication-definitions";
import type { SeedCustomerDefinition } from "./customer-definitions";
import { readSeedTagId, resolveSeedTags, seedId } from "./seed-ids";

export async function seedCommunicationTagIds(tx: DatabaseTransaction) {
  const communicationTagValues = seedCommunicationTags.map((name, index) => ({
    id: seedId("communicationTag", index + 1),
    name,
  }));
  await tx
    .insert(communicationTag)
    .values(communicationTagValues)
    .onConflictDoNothing();
  return resolveSeedTags(
    seedCommunicationTags,
    "communicationTag",
    await tx
      .select({
        id: communicationTag.id,
        normalizedName: communicationTag.normalizedName,
      })
      .from(communicationTag)
      .where(
        or(
          inArray(
            communicationTag.id,
            communicationTagValues.map(({ id }) => id)
          ),
          inArray(communicationTag.normalizedName, seedCommunicationTags)
        )
      )
  );
}

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
    communicationTags,
  }: {
    definition: SeedCustomerDefinition;
    offset: number;
    customerId: string;
    departmentId: string;
    ownerUserId: string;
    colleagueUserId: string;
    createdAt: Date;
    now: number;
    communicationTags: ReadonlyMap<string, string>;
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
    if (createdCommunication) {
      createdCount++;
      await tx.insert(communicationTagAssignment).values(
        [
          seedCommunicationTags[step],
          seedCommunicationTags[2 + (offset % 2)],
        ].map((name) => ({
          communicationId,
          tagId: readSeedTagId(communicationTags, name),
        }))
      );
    }
  }

  return createdCount;
}
