import type { ItemCardData } from '../models/item';
import type { ItemCardPage } from '../models/item-card-page';
import type { PrintQueueEntry } from '../models/print-queue';
import { A4_CARDS_PER_SHEET } from '../export/a4-sheet-geometry';

export interface PhysicalItemPlan {
	item?: ItemCardData;
	pages: readonly ItemCardPage[];
	unfitPageIndexes: ReadonlySet<number>;
	cacheKey?: string;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
}

export interface ResolvedPrintQueueEntry {
	entry: PrintQueueEntry;
	item?: ItemCardData;
	pages: readonly ItemCardPage[];
	unfitPageIndexes: ReadonlySet<number>;
	unavailable: boolean;
	cacheKey?: string;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
}

export interface PhysicalQueueCard {
	queueEntryId: string;
	filePath: string;
	itemName: string;
	copyIndex: number;
	pageIndex: number;
	page: ItemCardPage;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
}

export interface PrintQueueSummary {
	itemTypes: number;
	copies: number;
	physicalCards: number;
	a4Pages: number;
	unavailableEntries: number;
}

export function resolvePrintQueue(
	entries: readonly PrintQueueEntry[],
	items: readonly ItemCardData[],
	plans: ReadonlyMap<string, PhysicalItemPlan>,
): ResolvedPrintQueueEntry[] {
	const itemsByPath = new Map(items.map((item) => [item.filePath, item]));
	return entries.map((entry) => {
		const sourceItem = itemsByPath.get(entry.filePath);
		const plan = plans.get(entry.id) ?? plans.get(entry.filePath);
		const item = plan?.item ?? sourceItem;
		return {
			entry,
			...(item ? { item } : {}),
			pages: item && plan ? plan.pages : [],
			unfitPageIndexes: item && plan ? plan.unfitPageIndexes : new Set<number>(),
			unavailable: !item,
			...(item && plan?.cacheKey ? { cacheKey: plan.cacheKey } : {}),
			...(item && plan?.artworkResourcePath
				? { artworkResourcePath: plan.artworkResourcePath }
				: {}),
			...(item && plan?.artworkRevisionFingerprint
				? { artworkRevisionFingerprint: plan.artworkRevisionFingerprint }
				: {}),
		};
	});
}

export function flattenPrintQueue(
	entries: readonly ResolvedPrintQueueEntry[],
): PhysicalQueueCard[] {
	const flattened: PhysicalQueueCard[] = [];
	for (const resolved of entries) {
		if (!resolved.item || resolved.unavailable) {
			continue;
		}
		for (let copyIndex = 0; copyIndex < resolved.entry.quantity; copyIndex += 1) {
			for (const page of resolved.pages) {
				flattened.push({
					queueEntryId: resolved.entry.id,
					filePath: resolved.entry.filePath,
					itemName: resolved.item.name,
					copyIndex,
					pageIndex: page.pageIndex,
					page,
					...(resolved.artworkResourcePath
						? { artworkResourcePath: resolved.artworkResourcePath }
						: {}),
					...(resolved.artworkRevisionFingerprint
						? {
							artworkRevisionFingerprint:
								resolved.artworkRevisionFingerprint,
						}
						: {}),
				});
			}
		}
	}
	return flattened;
}

export function calculatePrintQueueSummary(
	entries: readonly ResolvedPrintQueueEntry[],
): PrintQueueSummary {
	const copies = entries.reduce((total, resolved) => total + resolved.entry.quantity, 0);
	const physicalCards = entries.reduce(
		(total, resolved) => total + resolved.pages.length * resolved.entry.quantity,
		0,
	);
	return {
		itemTypes: entries.length,
		copies,
		physicalCards,
		a4Pages: Math.ceil(physicalCards / A4_CARDS_PER_SHEET),
		unavailableEntries: entries.filter((entry) => entry.unavailable).length,
	};
}

export function getInvalidQueueEntries(
	entries: readonly ResolvedPrintQueueEntry[],
): ResolvedPrintQueueEntry[] {
	return entries.filter(
		(entry) => entry.unavailable || entry.unfitPageIndexes.size > 0,
	);
}
