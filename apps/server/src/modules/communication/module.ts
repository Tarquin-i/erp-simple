import type { Database } from "@repo/db";
import { createAttachmentCleanup } from "./application/attachment-cleanup";
import { createAttachmentUseCases } from "./application/attachments";
import { createCommunicationRecordUseCases } from "./application/communication-records";
import { createCommunicationTagUseCases } from "./application/tags";
import { attachmentStorageFromEnv } from "./storage/object-store";
import type { GetAttachmentStorage } from "./storage/object-store";

export function createCommunicationModule(
  db: Database,
  getStorage: GetAttachmentStorage = attachmentStorageFromEnv
) {
  const cleanup = createAttachmentCleanup(db, getStorage);
  return {
    records: createCommunicationRecordUseCases(db, cleanup),
    tags: createCommunicationTagUseCases(db),
    attachments: createAttachmentUseCases(db, getStorage, cleanup),
    startAttachmentUploadCleanup: cleanup.startAttachmentUploadCleanup,
  };
}

export type CommunicationModule = ReturnType<typeof createCommunicationModule>;
