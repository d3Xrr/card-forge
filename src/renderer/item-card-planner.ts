import type { ItemCardData } from '../models/item';
import type { ItemCardPage, ItemCardPageKind } from '../models/item-card-page';
import type { ArtworkOrientation } from './artwork-orientation';
import {
	estimateDescriptionLoad,
	selectItemCardLayout,
	type ItemCardLayout,
} from './item-card-layout';
import {
	cloneMarkdownBlock,
	parseSemanticMarkdown,
	partitionCraftingSection,
	serializeSemanticMarkdown,
	type MarkdownBlock,
} from './semantic-markdown';

export interface ItemCardPlanOptions {
	artworkOrientation?: ArtworkOrientation;
	artworkAvailable?: boolean;
	capacityScale?: number;
}

interface PlannedPageContent {
	kind: ItemCardPageKind;
	blocks: MarkdownBlock[];
	layout: ItemCardLayout;
	showArtwork: boolean;
	hasUnsplitOverflow: boolean;
}

interface PackedBlocks {
	pages: MarkdownBlock[][];
	oversizedPageIndexes: Set<number>;
}

const PAGE_CAPACITIES: Record<ItemCardLayout | 'continuation' | 'crafting', number> = {
	image: 10.5,
	portrait: 12,
	compact: 18,
	text: 28,
	continuation: 31,
	crafting: 29,
};

export function planItemCardPages(
	item: ItemCardData,
	options: ItemCardPlanOptions = {},
): ItemCardPage[] {
	const capacityScale = clampCapacityScale(options.capacityScale ?? 1);
	const allBlocks = parseSemanticMarkdown(item.description);
	const sections = partitionCraftingSection(allBlocks);
	const artworkAvailable = options.artworkAvailable ?? item.hasImage;
	const layoutItem = artworkAvailable ? item : { ...item, hasImage: false };
	const primaryLayout = selectItemCardLayout(layoutItem, options.artworkOrientation);
	const primaryCapacity = PAGE_CAPACITIES[primaryLayout] * capacityScale;
	const continuationCapacity = PAGE_CAPACITIES.continuation * capacityScale;
	const planned: PlannedPageContent[] = [];

	const combinedLoad = estimateBlocksLoad([...sections.main, ...sections.crafting]);
	if (sections.crafting.length > 0 && combinedLoad <= primaryCapacity) {
		planned.push({
			kind: 'primary',
			blocks: [...sections.main, ...sections.crafting].map(cloneMarkdownBlock),
			layout: primaryLayout,
			showArtwork: artworkAvailable && primaryLayout !== 'text',
			hasUnsplitOverflow: false,
		});
	} else {
		appendPackedSection(
			planned,
			sections.main,
			primaryCapacity,
			continuationCapacity,
			primaryLayout,
			artworkAvailable,
		);
		appendCraftingPages(planned, sections.crafting, capacityScale);
	}

	if (planned.length === 0) {
		planned.push({
			kind: 'primary',
			blocks: [],
			layout: primaryLayout,
			showArtwork: artworkAvailable && primaryLayout !== 'text',
			hasUnsplitOverflow: false,
		});
	}

	const pageCount = planned.length;
	return planned.map((page, pageIndex) => ({
		item,
		pageIndex,
		pageCount,
		kind: page.kind,
		title: item.name,
		blocks: page.blocks,
		layout: page.layout,
		showArtwork: page.showArtwork,
		showSource: pageIndex === pageCount - 1,
		...(options.artworkOrientation
			? { artworkOrientation: options.artworkOrientation }
			: {}),
		hasUnsplitOverflow: page.hasUnsplitOverflow,
	}));
}

export function estimateBlocksLoad(blocks: readonly MarkdownBlock[]): number {
	return blocks.reduce((total, block) => total + estimateBlockLoad(block), 0);
}

export function flattenPageContent(pages: readonly ItemCardPage[]): string {
	return serializeSemanticMarkdown(pages.flatMap((page) => page.blocks));
}

function appendPackedSection(
	planned: PlannedPageContent[],
	blocks: readonly MarkdownBlock[],
	primaryCapacity: number,
	continuationCapacity: number,
	primaryLayout: ItemCardLayout,
	artworkAvailable: boolean,
): void {
	if (blocks.length === 0) {
		return;
	}

	const firstPage = packBlocks(blocks, primaryCapacity, true);
	const primaryBlocks = firstPage.pages[0] ?? [];
	planned.push({
		kind: 'primary',
		blocks: primaryBlocks,
		layout: primaryLayout,
		showArtwork: artworkAvailable && primaryLayout !== 'text',
		hasUnsplitOverflow: firstPage.oversizedPageIndexes.has(0),
	});

	const consumedCount = countEquivalentBlocks(primaryBlocks);
	const remainingBlocks = expandOversizedBlocks(blocks, primaryCapacity).slice(consumedCount);
	if (remainingBlocks.length === 0) {
		return;
	}

	const continuations = packBlocks(remainingBlocks, continuationCapacity, false);
	for (const [index, pageBlocks] of continuations.pages.entries()) {
		planned.push({
			kind: 'continuation',
			blocks: pageBlocks,
			layout: 'text',
			showArtwork: false,
			hasUnsplitOverflow: continuations.oversizedPageIndexes.has(index),
		});
	}
}

function appendCraftingPages(
	planned: PlannedPageContent[],
	blocks: readonly MarkdownBlock[],
	capacityScale: number,
): void {
	if (blocks.length === 0) {
		return;
	}

	const packed = packBlocks(blocks, PAGE_CAPACITIES.crafting * capacityScale, false);
	for (const [index, pageBlocks] of packed.pages.entries()) {
		planned.push({
			kind: 'crafting',
			blocks: pageBlocks,
			layout: 'text',
			showArtwork: false,
			hasUnsplitOverflow: packed.oversizedPageIndexes.has(index),
		});
	}
}

function packBlocks(
	blocks: readonly MarkdownBlock[],
	capacity: number,
	stopAfterFirstPage: boolean,
): PackedBlocks {
	const expandedBlocks = expandOversizedBlocks(blocks, capacity);
	const pages: MarkdownBlock[][] = [];
	const oversizedPageIndexes = new Set<number>();
	let currentPage: MarkdownBlock[] = [];
	let currentLoad = 0;

	for (let index = 0; index < expandedBlocks.length; index += 1) {
		const block = expandedBlocks[index];
		if (!block) {
			continue;
		}
		const blockLoad = estimateBlockLoad(block);
		const nextBlock = expandedBlocks[index + 1];
		const headingBundleLoad = block.type === 'heading' && nextBlock
			? blockLoad + estimateBlockLoad(nextBlock)
			: blockLoad;
		const shouldMoveToNextPage = currentPage.length > 0
			&& currentLoad + headingBundleLoad > capacity;

		if (shouldMoveToNextPage) {
			pages.push(currentPage);
			if (stopAfterFirstPage) {
				return { pages, oversizedPageIndexes };
			}
			currentPage = [];
			currentLoad = 0;
		}

		currentPage.push(cloneMarkdownBlock(block));
		currentLoad += blockLoad;
		if (blockLoad > capacity) {
			oversizedPageIndexes.add(pages.length);
		}
	}

	if (currentPage.length > 0) {
		pages.push(currentPage);
	}
	return { pages, oversizedPageIndexes };
}

function expandOversizedBlocks(
	blocks: readonly MarkdownBlock[],
	capacity: number,
): MarkdownBlock[] {
	return blocks.flatMap((block) => splitBlock(block, capacity));
}

function splitBlock(block: MarkdownBlock, capacity: number): MarkdownBlock[] {
	if (block.type === 'heading') {
		return [cloneMarkdownBlock(block)];
	}
	if (estimateBlockLoad(block) <= capacity) {
		return [cloneMarkdownBlock(block)];
	}

	if (block.type === 'paragraph') {
		return splitParagraphBlock(block, capacity);
	}
	return splitListBlock(block, capacity);
}

function splitListBlock(
	block: Extract<MarkdownBlock, { type: 'unordered-list' | 'ordered-list' }>,
	capacity: number,
): MarkdownBlock[] {
	const results: MarkdownBlock[] = [];
	let items: string[] = [];
	let load = 0;

	for (const item of block.items) {
		const itemLoad = estimateTextLoad(item, 34) + 0.4;
		if (items.length > 0 && load + itemLoad > capacity) {
			results.push({ type: block.type, items });
			items = [];
			load = 0;
		}
		items.push(item);
		load += itemLoad;
	}
	if (items.length > 0) {
		results.push({ type: block.type, items });
	}
	return results;
}

function splitParagraphBlock(
	block: Extract<MarkdownBlock, { type: 'paragraph' }>,
	capacity: number,
): MarkdownBlock[] {
	const sentences = block.markdown.split(/(?<=[.!?])\s+(?=[A-Z0-9*_[`])/u);
	if (sentences.length <= 1 || !sentences.every(hasBalancedInlineMarkdown)) {
		return [cloneMarkdownBlock(block)];
	}

	const results: MarkdownBlock[] = [];
	let current = '';
	for (const sentence of sentences) {
		const candidate = current ? `${current} ${sentence}` : sentence;
		if (current && estimateTextLoad(candidate, 43) > capacity) {
			results.push({ type: 'paragraph', markdown: current });
			current = sentence;
		} else {
			current = candidate;
		}
	}
	if (current) {
		results.push({ type: 'paragraph', markdown: current });
	}
	return results;
}

function hasBalancedInlineMarkdown(markdown: string): boolean {
	const backtickCount = countOccurrences(markdown, '`');
	const strongAsteriskCount = countOccurrences(markdown, '**');
	const strongUnderscoreCount = countOccurrences(markdown, '__');
	const withoutStrong = markdown.replaceAll('**', '').replaceAll('__', '');
	return backtickCount % 2 === 0
		&& strongAsteriskCount % 2 === 0
		&& strongUnderscoreCount % 2 === 0
		&& countOccurrences(withoutStrong, '*') % 2 === 0
		&& countOccurrences(withoutStrong, '_') % 2 === 0;
}

function countOccurrences(value: string, token: string): number {
	return value.split(token).length - 1;
}

function estimateBlockLoad(block: MarkdownBlock): number {
	switch (block.type) {
		case 'heading':
			return block.level === 2 ? 1.6 : 1.3;
		case 'unordered-list':
		case 'ordered-list':
			return block.items.reduce(
				(total, item) => total + estimateTextLoad(item, 34) + 0.4,
				0,
			);
		case 'paragraph':
			return estimateDescriptionLoad(block.markdown);
	}
}

function estimateTextLoad(markdown: string, approximateWidth: number): number {
	const text = markdown.replace(/[*_`~]/gu, '').trim();
	return Math.max(1, Math.ceil(text.length / approximateWidth));
}

function countEquivalentBlocks(blocks: readonly MarkdownBlock[]): number {
	return blocks.length;
}

function clampCapacityScale(scale: number): number {
	return Math.min(1, Math.max(0.55, scale));
}
