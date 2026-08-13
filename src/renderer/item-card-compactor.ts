import type { ItemCardPage, MarkdownBlock } from '../models/item-card-page';
import { cloneMarkdownBlock } from './semantic-markdown';

export type ItemCardPageFitPredicate = (
	page: ItemCardPage,
) => boolean | Promise<boolean>;

export async function compactContinuationPages(
	pages: readonly ItemCardPage[],
	canFit: ItemCardPageFitPredicate,
): Promise<ItemCardPage[]> {
	const compacted = pages.map(cloneItemCardPage);
	let pageIndex = 0;

	while (pageIndex < compacted.length - 1) {
		const current = compacted[pageIndex];
		const next = compacted[pageIndex + 1];
		if (!current || !next || !canCompactAcross(current, next)) {
			pageIndex += 1;
			continue;
		}

		if (next.blocks.length === 0) {
			compacted.splice(pageIndex + 1, 1);
			continue;
		}

		const movingCount = getLeadingMoveGroupSize(next.blocks);
		const moving = next.blocks.splice(0, movingCount);
		current.blocks.push(...moving);

		if (await canFit(current)) {
			if (next.blocks.length === 0) {
				compacted.splice(pageIndex + 1, 1);
			}
			continue;
		}

		current.blocks.splice(current.blocks.length - moving.length, moving.length);
		next.blocks.unshift(...moving);
		pageIndex += 1;
	}

	return normalizeItemCardPages(compacted);
}

function cloneItemCardPage(page: ItemCardPage): ItemCardPage {
	return {
		...page,
		blocks: page.blocks.map(cloneMarkdownBlock),
	};
}

function canCompactAcross(current: ItemCardPage, next: ItemCardPage): boolean {
	return current.kind === 'continuation' && next.kind === 'continuation';
}

function getLeadingMoveGroupSize(blocks: readonly MarkdownBlock[]): number {
	return blocks[0]?.type === 'heading' && blocks.length > 1 ? 2 : 1;
}

function normalizeItemCardPages(pages: ItemCardPage[]): ItemCardPage[] {
	const pageCount = pages.length;
	return pages.map((page, pageIndex) => ({
		...page,
		pageIndex,
		pageCount,
		showSource: pageIndex === pageCount - 1,
	}));
}
