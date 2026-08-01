import type { Message } from '@earendil-works/pi-ai';
import type { ArchiveRecord, ArchiveStore } from '../sdk/storage-provider.js';
import { generateId } from '../shared/generate-id.js';

/** 保存压缩前快照；compressionHistory 由 SessionUsecase 作为单一写入方维护。 */
export async function archiveConversation(
  archiveStore: ArchiveStore,
  sessionId: string,
  before: Message[],
): Promise<string> {
  const previousArchive = await archiveStore.getLatest(sessionId);
  const archiveId = generateId();
  const record: ArchiveRecord = {
    id: archiveId,
    sessionId,
    compressedAt: new Date(),
    version: previousArchive ? previousArchive.version + 1 : 1,
    parentArchiveId: previousArchive?.id,
    conversationSnapshot: before,
    summary: '',
  };
  await archiveStore.save(record);
  return archiveId;
}
