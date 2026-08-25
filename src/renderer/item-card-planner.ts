import type { ItemCardData } from '../models/item';
import {
	createLayoutDesignFingerprint,
	isCardDesignFieldVisible,
	LEGACY_CARD_DESIGN_PROFILE,
	normalizeCardDesignProfile,
	type CardArtworkSize,
	type CardDesignProfile,
} from '../models/card-design';
import type {
	ItemCardPage,
	ItemCardPageKind,
	ItemStatsPresentation,
} from '../models/item-card-page';
import type { ArtworkOrientation } from './artwork-orientation';
import {
	estimateDescriptionLoad,
	selectItemCardLayout,
	selectPreferredBodyFontPoints,
	type ItemCardLayout,
} from './item-card-layout';
import {
	cloneMarkdownBlock,
	parseSemanticMarkdown,
	partitionCraftingSection,
	serializeSemanticMarkdown,
	type MarkdownBlock,
} from './semantic-markdown';
import {
	estimateItemStatsLoad,
	hasMeaningfulItemStats,
} from './structured-item-stats';
import type { PlanningPerformanceTrace } from '../services/planning-performance';

export interface ItemCardPlanOptions {
	artworkOrientation?: ArtworkOrientation;
	artworkAvailable?: boolean;
	capacityScale?: number;
	bodyFontPoints?: number;
	artworkSharePercent?: number;
	design?: CardDesignProfile;
	performanceTrace?: PlanningPerformanceTrace;
}

export interface PreparedItemCardPlanningContext {
	allBlocks: readonly MarkdownBlock[];
	sections: Readonly<{
		main: readonly MarkdownBlock[];
		crafting: readonly MarkdownBlock[];
	}>;
	manualSegments?: readonly (readonly MarkdownBlock[])[];
}

export type ItemCardPagePlanner = (
	options?: ItemCardPlanOptions,
) => ItemCardPage[];

export type ItemCardContentStrategy =
	| 'full-stats'
	| 'prose-artwork-compact-stats'
	| 'prose-compact-stats'
	| 'prose-only';

interface PlannedPageContent {
	kind: ItemCardPageKind;
	blocks: MarkdownBlock[];
	layout: ItemCardLayout;
	showArtwork: boolean;
	showStats: boolean;
	statsPresentation?: ItemStatsPresentation;
	bodyFontPoints: number;
	artworkSharePercent?: number;
	hasUnsplitOverflow: boolean;
	contentCapacity: number;
}

export interface BalanceableCardPage {
	kind: ItemCardPageKind;
	blocks: MarkdownBlock[];
	contentCapacity: number;
}

interface PackedBlocks {
	pages: MarkdownBlock[][];
	oversizedPageIndexes: Set<number>;
}

const MINIMUM_BODY_CAPACITIES: Record<ItemCardLayout | 'continuation' | 'crafting', number> = {
	image: 10.5,
	portrait: 12,
	compact: 18,
	text: 28,
	continuation: 31,
	crafting: 29,
};
const SPARSE_FINAL_PAGE_THRESHOLD = 0.38;
const BALANCED_FINAL_PAGE_TARGET = 0.46;

export function planItemCardPages(
	item: ItemCardData,
	options: ItemCardPlanOptions = {},
): ItemCardPage[] {
	return planPreparedItemCardPages(
		item,
		prepareItemCardPlanningContext(item, options.performanceTrace),
		options,
	);
}

export function prepareItemCardPlanningContext(
	item: ItemCardData,
	performanceTrace?: PlanningPerformanceTrace,
): PreparedItemCardPlanningContext {
	const allBlocks = performanceTrace
		? performanceTrace.measure(
			'semanticParsing',
			() => parseSemanticMarkdown(item.description),
		)
		: parseSemanticMarkdown(item.description);
	const sections = partitionCraftingSection(allBlocks);
	const manualSegments = item.manualRuleSegments && item.manualRuleSegments.length > 1
		? item.manualRuleSegments.map((segment) => parseSemanticMarkdown(segment))
		: undefined;
	return { allBlocks, sections, ...(manualSegments ? { manualSegments } : {}) };
}

export function createMemoizedItemCardPagePlanner(
	item: ItemCardData,
	context: PreparedItemCardPlanningContext,
): ItemCardPagePlanner {
	const pagesByOptions = new Map<string, ItemCardPage[]>();
	return (options: ItemCardPlanOptions = {}) => {
		const key = createItemCardPlanOptionsKey(item, options);
		const cached = pagesByOptions.get(key);
		if (cached) {
			options.performanceTrace?.increment('candidatePageCacheHits');
			return cached;
		}

		options.performanceTrace?.increment('candidatePageCacheMisses');
		const pages = planPreparedItemCardPages(item, context, options);
		pagesByOptions.set(key, pages);
		return pages;
	};
}

function createItemCardPlanOptionsKey(
	item: ItemCardData,
	options: ItemCardPlanOptions,
): string {
	return JSON.stringify({
		artworkOrientation: options.artworkOrientation ?? null,
		artworkAvailable: options.artworkAvailable ?? item.hasImage,
		capacityScale: clampCapacityScale(options.capacityScale ?? 1),
		bodyFontPoints: clampBodyFontPoints(
			options.bodyFontPoints ?? selectPreferredBodyFontPoints(item.description),
		),
		artworkSharePercent: options.artworkSharePercent ?? null,
		layoutDesignFingerprint: createLayoutDesignFingerprint(options.design),
	});
}

export function planPreparedItemCardPages(
	item: ItemCardData,
	context: PreparedItemCardPlanningContext,
	options: ItemCardPlanOptions = {},
): ItemCardPage[] {
	if (context.manualSegments && context.manualSegments.length > 1) {
		return planManualCardSegments(item, context, options);
	}
	const design = normalizeCardDesignProfile(options.design);
	const densityCapacityMultiplier = design.density === 'compact' ? 1.12 : 1;
	const capacityScale = clampCapacityScale(options.capacityScale ?? 1)
		* densityCapacityMultiplier;
	const { allBlocks, sections } = context;
	const artworkAvailable = design.artworkSize !== 'hidden'
		&& (options.artworkAvailable ?? item.hasImage);
	const layoutItem = artworkAvailable ? item : { ...item, hasImage: false };
	const strategy = selectItemCardContentStrategy(
		item,
		artworkAvailable,
		allBlocks.length > 0,
		design,
	);
	const statsPresentation = getStrategyStatsPresentation(strategy);
	const bodyFontPoints = clampBodyFontPoints(
		options.bodyFontPoints ?? selectPreferredBodyFontPoints(item.description),
	);
	const typographyCapacityScale = 7 / bodyFontPoints;
	const primaryLayout = selectPlannerPrimaryLayout(
		layoutItem,
		options.artworkOrientation,
		statsPresentation,
	);
	const artworkSharePercent = resolveArtworkSharePercent(
		primaryLayout,
		design.artworkSize,
		options.artworkSharePercent,
	);
	const primaryCapacity = MINIMUM_BODY_CAPACITIES[primaryLayout]
		* typographyCapacityScale
		* capacityScale;
	const primaryContentCapacity = Math.max(
		1,
		primaryCapacity - (statsPresentation
			? estimateItemStatsLoad(item, statsPresentation, design)
			: 0),
	);
	const continuationCapacity = MINIMUM_BODY_CAPACITIES.continuation
		* typographyCapacityScale
		* capacityScale;
	const planned: PlannedPageContent[] = [];

	const combinedLoad = estimateBlocksLoad([...sections.main, ...sections.crafting]);
	if (sections.crafting.length > 0 && combinedLoad <= primaryContentCapacity) {
		planned.push({
			kind: 'primary',
			blocks: [...sections.main, ...sections.crafting].map(cloneMarkdownBlock),
			layout: primaryLayout,
			showArtwork: artworkAvailable && primaryLayout !== 'text',
			showStats: statsPresentation !== undefined,
			...(statsPresentation ? { statsPresentation } : {}),
			bodyFontPoints,
			...(artworkSharePercent !== undefined
				? { artworkSharePercent }
				: {}),
			hasUnsplitOverflow: false,
			contentCapacity: primaryContentCapacity,
		});
	} else {
		appendPackedSection(
			planned,
			sections.main,
			primaryContentCapacity,
			continuationCapacity,
			primaryLayout,
			artworkAvailable,
			statsPresentation,
			bodyFontPoints,
			artworkSharePercent,
		);
		appendCraftingPages(
			planned,
			sections.crafting,
			capacityScale * typographyCapacityScale,
			bodyFontPoints,
		);
	}

	if (planned.length === 0) {
		planned.push({
			kind: 'primary',
			blocks: [],
			layout: primaryLayout,
			showArtwork: artworkAvailable && primaryLayout !== 'text',
			showStats: statsPresentation !== undefined,
			...(statsPresentation ? { statsPresentation } : {}),
			bodyFontPoints,
			...(artworkSharePercent !== undefined
				? { artworkSharePercent }
				: {}),
			hasUnsplitOverflow: false,
			contentCapacity: primaryContentCapacity,
		});
	}

	balanceSparseFinalPage(planned);

	const pageCount = planned.length;
	return planned.map((page, pageIndex) => ({
		item,
		pageIndex,
		pageCount,
		kind: page.kind,
		title: item.name,
		blocks: page.blocks,
		layout: page.layout,
		bodyFontPoints: page.bodyFontPoints,
		...(page.artworkSharePercent !== undefined
			? { artworkSharePercent: page.artworkSharePercent }
			: {}),
		showArtwork: page.showArtwork,
		showStats: page.showStats,
		...(page.statsPresentation
			? { statsPresentation: page.statsPresentation }
			: {}),
		showSource: pageIndex === pageCount - 1
			&& isCardDesignFieldVisible(item, 'source', design),
		...(options.artworkOrientation
			? { artworkOrientation: options.artworkOrientation }
			: {}),
		hasUnsplitOverflow: page.hasUnsplitOverflow,
	}));
}

function planManualCardSegments(
	item: ItemCardData,
	context: PreparedItemCardPlanningContext,
	options: ItemCardPlanOptions,
): ItemCardPage[] {
	const segments = context.manualSegments ?? [];
	const firstBlocks = segments[0] ?? [];
	const itemWithoutBreaks: ItemCardData = { ...item };
	delete itemWithoutBreaks.manualRuleSegments;
	const firstPages = planPreparedItemCardPages(
		itemWithoutBreaks,
		{ allBlocks: firstBlocks, sections: partitionCraftingSection(firstBlocks) },
		options,
	);
	const bodyFontPoints = clampBodyFontPoints(
		options.bodyFontPoints ?? selectPreferredBodyFontPoints(item.description),
	);
	const design = normalizeCardDesignProfile(options.design);
	const densityCapacityMultiplier = design.density === 'compact' ? 1.12 : 1;
	const continuationCapacity = MINIMUM_BODY_CAPACITIES.continuation
		* (7 / bodyFontPoints)
		* clampCapacityScale(options.capacityScale ?? 1)
		* densityCapacityMultiplier;
	const subsequentPages: ItemCardPage[] = [];
	for (const segment of segments.slice(1)) {
		const packed = packBlocks(segment, continuationCapacity, false);
		const pageBlocks = packed.pages.length > 0 ? packed.pages : [[]];
		const balanceable = pageBlocks.map((blocks) => ({
			kind: 'continuation' as const,
			blocks,
			contentCapacity: continuationCapacity,
		}));
		balanceSparseFinalPage(balanceable);
		for (const [index, page] of balanceable.entries()) {
			subsequentPages.push({
				item,
				pageIndex: 0,
				pageCount: 0,
				kind: 'continuation',
				title: item.name,
				blocks: page.blocks,
				layout: 'text',
				bodyFontPoints,
				showArtwork: false,
				showStats: false,
				showSource: false,
				...(options.artworkOrientation
					? { artworkOrientation: options.artworkOrientation }
					: {}),
				hasUnsplitOverflow: packed.oversizedPageIndexes.has(index),
			});
		}
	}
	const combined = [...firstPages, ...subsequentPages];
	return combined.map((page, pageIndex) => ({
		...page,
		item,
		title: item.name,
		pageIndex,
		pageCount: combined.length,
		showSource: pageIndex === combined.length - 1
			&& isCardDesignFieldVisible(item, 'source', design),
	}));
}

export function selectItemCardContentStrategy(
	item: ItemCardData,
	artworkAvailable = item.hasImage,
	hasRulesProse = parseSemanticMarkdown(item.description).length > 0,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): ItemCardContentStrategy {
	if (!hasRulesProse && hasMeaningfulItemStats(item, design)) {
		return 'full-stats';
	}
	if (hasRulesProse && hasMeaningfulItemStats(item, design)) {
		return artworkAvailable
			? 'prose-artwork-compact-stats'
			: 'prose-compact-stats';
	}
	return 'prose-only';
}

export const ARTWORK_PRESET_ALLOCATIONS = Object.freeze({
	larger: Object.freeze({ image: 56, portrait: 42, compact: 36, text: 0 }),
	minimal: Object.freeze({ image: 16, portrait: 28, compact: 16, text: 0 }),
});

export function resolveArtworkSharePercent(
	layout: ItemCardLayout,
	artworkSize: CardArtworkSize,
	standardOverride?: number,
): number | undefined {
	if (layout === 'text' || artworkSize === 'hidden') {
		return undefined;
	}
	if (artworkSize === 'standard') {
		return standardOverride;
	}
	return ARTWORK_PRESET_ALLOCATIONS[artworkSize][layout];
}

export function balanceSparseFinalPage<T extends BalanceableCardPage>(pages: T[]): void {
	if (pages.length < 2) {
		return;
	}

	const previous = pages.at(-2);
	const final = pages.at(-1);
	if (!previous || !final || !canBalanceAcrossKinds(previous.kind, final.kind)) {
		return;
	}

	let finalLoad = estimateBlocksLoad(final.blocks);
	if (finalLoad / final.contentCapacity >= SPARSE_FINAL_PAGE_THRESHOLD) {
		return;
	}

	while (previous.blocks.length > 1) {
		let moveStart = previous.blocks.length - 1;
		if (moveStart > 0 && isHeadingLikeBlock(previous.blocks[moveStart - 1])) {
			moveStart -= 1;
		}
		if (moveStart === 0) {
			return;
		}

		const moving = previous.blocks.slice(moveStart);
		const movingLoad = estimateBlocksLoad(moving);
		if (finalLoad + movingLoad > final.contentCapacity) {
			return;
		}

		previous.blocks.splice(moveStart, moving.length);
		final.blocks.unshift(...moving.map(cloneMarkdownBlock));
		finalLoad += movingLoad;
		if (finalLoad / final.contentCapacity >= BALANCED_FINAL_PAGE_TARGET) {
			return;
		}
	}
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
	statsPresentation: ItemStatsPresentation | undefined,
	bodyFontPoints: number,
	artworkSharePercent: number | undefined,
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
		showStats: statsPresentation !== undefined,
		...(statsPresentation ? { statsPresentation } : {}),
		bodyFontPoints,
		...(artworkSharePercent !== undefined ? { artworkSharePercent } : {}),
		hasUnsplitOverflow: firstPage.oversizedPageIndexes.has(0),
		contentCapacity: primaryCapacity,
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
			showStats: false,
			bodyFontPoints,
			hasUnsplitOverflow: continuations.oversizedPageIndexes.has(index),
			contentCapacity: continuationCapacity,
		});
	}
}

function appendCraftingPages(
	planned: PlannedPageContent[],
	blocks: readonly MarkdownBlock[],
	capacityScale: number,
	bodyFontPoints: number,
): void {
	if (blocks.length === 0) {
		return;
	}

	const craftingCapacity = MINIMUM_BODY_CAPACITIES.crafting * capacityScale;
	const packed = packBlocks(blocks, craftingCapacity, false);
	for (const [index, pageBlocks] of packed.pages.entries()) {
		planned.push({
			kind: 'crafting',
			blocks: pageBlocks,
			layout: 'text',
			showArtwork: false,
			showStats: false,
			bodyFontPoints,
			hasUnsplitOverflow: packed.oversizedPageIndexes.has(index),
			contentCapacity: craftingCapacity,
		});
	}
}

function getStrategyStatsPresentation(
	strategy: ItemCardContentStrategy,
): ItemStatsPresentation | undefined {
	if (strategy === 'full-stats') {
		return 'full';
	}
	return strategy === 'prose-artwork-compact-stats'
		|| strategy === 'prose-compact-stats'
		? 'compact'
		: undefined;
}

function clampBodyFontPoints(points: number): number {
	return Math.min(10, Math.max(7, points));
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
		const headingBundleLoad = isHeadingLikeBlock(block) && nextBlock
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
	if (block.type === 'table') {
		return splitTableBlock(block, capacity);
	}
	return splitListBlock(block, capacity);
}

function splitTableBlock(
	block: Extract<MarkdownBlock, { type: 'table' }>,
	capacity: number,
): MarkdownBlock[] {
	const headerLoad = estimateTableHeaderLoad(block.headers);
	const results: MarkdownBlock[] = [];
	let rows: string[][] = [];
	let load = headerLoad;

	for (const row of block.rows) {
		const rowLoad = estimateTableRowLoad(row);
		if (rows.length > 0 && load + rowLoad > capacity) {
			results.push({
				type: 'table',
				headers: [...block.headers],
				rows,
			});
			rows = [];
			load = headerLoad;
		}
		rows.push([...row]);
		load += rowLoad;
	}
	if (rows.length > 0 || results.length === 0) {
		results.push({
			type: 'table',
			headers: [...block.headers],
			rows,
		});
	}
	return results;
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
		case 'table':
			return estimateTableHeaderLoad(block.headers)
				+ block.rows.reduce((total, row) => total + estimateTableRowLoad(row), 0);
		case 'paragraph':
			return estimateDescriptionLoad(block.markdown);
	}
}

function estimateTableHeaderLoad(headers: readonly string[]): number {
	return 1.2 + estimateTableRowLoad(headers) * 0.65;
}

function estimateTableRowLoad(row: readonly string[]): number {
	const longestCellLoad = row.reduce(
		(longest, cell) => Math.max(longest, estimateTextLoad(cell, 20)),
		1,
	);
	return Math.max(0.9, longestCellLoad * 0.85);
}

function estimateTextLoad(markdown: string, approximateWidth: number): number {
	const text = markdown.replace(/[*_`~]/gu, '').trim();
	return Math.max(1, Math.ceil(text.length / approximateWidth));
}

function countEquivalentBlocks(blocks: readonly MarkdownBlock[]): number {
	return blocks.length;
}

function selectPlannerPrimaryLayout(
	item: ItemCardData,
	artworkOrientation: ArtworkOrientation | undefined,
	statsPresentation: ItemStatsPresentation | undefined,
): ItemCardLayout {
	const selected = selectItemCardLayout(item, artworkOrientation);
	if (!item.hasImage || selected !== 'text') {
		if (selected === 'image' && statsPresentation === 'full') {
			return 'compact';
		}
		return selected;
	}
	return artworkOrientation === 'portrait' ? 'portrait' : 'compact';
}

function canBalanceAcrossKinds(
	previous: ItemCardPageKind,
	final: ItemCardPageKind,
): boolean {
	return previous === 'crafting' ? final === 'crafting' : final !== 'crafting';
}

function isHeadingLikeBlock(block: MarkdownBlock | undefined): boolean {
	return Boolean(
		block?.type === 'heading'
		|| (block?.type === 'paragraph'
			&& /^\s*(?:\*\*[^*]+\*\*|__[^_]+__)\s*$/u.test(block.markdown)),
	);
}

function clampCapacityScale(scale: number): number {
	return Math.min(1, Math.max(0.25, scale));
}
