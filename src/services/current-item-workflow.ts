import type { ItemCardData } from '../models/item';
import type { CardDesignProfile } from '../models/card-design';
import type { PrintQueueEntry, PrintQueueService } from '../models/print-queue';

export interface ActiveVaultFileIdentity {
	path: string;
	extension: string;
}

export function resolveCurrentIndexedItem(
	items: readonly ItemCardData[],
	activeFile: ActiveVaultFileIdentity | null | undefined,
): ItemCardData | undefined {
	if (!activeFile || activeFile.extension.toLocaleLowerCase() !== 'md') {
		return undefined;
	}
	return items.find((item) => item.filePath === activeFile.path);
}

/** Adds canonical source state only; editor drafts are deliberately not accepted. */
export function addCurrentIndexedItemToQueue(
	queue: PrintQueueService,
	item: ItemCardData,
	design?: CardDesignProfile,
): PrintQueueEntry {
	return queue.add(item.filePath, undefined, design);
}
