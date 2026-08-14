import type { ItemCardData } from '../models/item';
import type {
	ItemCardPage,
	MarkdownBlock,
} from '../models/item-card-page';
import { PHYSICAL_CARD_PROFILE } from '../models/physical-card-profile';

export const ITEM_CARD_PLAN_SIGNATURE_VERSION = 'item-card-plan-signature-v1';

export interface HashedPlanText {
	length: number;
	hash: string;
}

export interface ItemCardPlanSignature {
	version: typeof ITEM_CARD_PLAN_SIGNATURE_VERSION;
	physicalProfile: {
		widthMm: number;
		heightMm: number;
		widthPx: number;
		heightPx: number;
		dpi: number;
	};
	pageCount: number;
	pages: ItemCardPageSignature[];
}

export interface FittedItemCardPlanLike {
	pages: readonly ItemCardPage[];
	capacityScale: number;
	bodyFontPoints: number;
	unfitPageIndexes: ReadonlySet<number>;
	artworkResult: {
		status: string;
		orientation?: string;
	};
}

export interface FittedItemCardPlanSignature {
	plan: ItemCardPlanSignature;
	capacityScale: number;
	bodyFontPoints: number;
	unfitPageIndexes: number[];
	exportable: boolean;
	artworkResult: {
		status: string;
		orientation: string | null;
	};
}

export interface ItemCardPageSignature {
	item: ItemCardPlanItemSignature;
	pageIndex: number;
	pageCount: number;
	kind: ItemCardPage['kind'];
	title: HashedPlanText;
	blocks: MarkdownBlockSignature[];
	layout: ItemCardPage['layout'];
	bodyFontPoints: number | null;
	artworkSharePercent: number | null;
	showArtwork: boolean;
	showStats: boolean;
	statsPresentation: ItemCardPage['statsPresentation'] | null;
	showSource: boolean;
	artworkOrientation: ItemCardPage['artworkOrientation'] | null;
	hasUnsplitOverflow: boolean;
}

export interface ItemCardPlanItemSignature {
	filePath: HashedPlanText;
	name: HashedPlanText;
	description: HashedPlanText;
	detail: HashedPlanText | null;
	imagePath: HashedPlanText | null;
	sourceText: HashedPlanText | null;
	hasImage: boolean;
	rarity: HashedPlanText | null;
	attunement: boolean | null;
	source: HashedPlanText | null;
	damage: HashedPlanText | null;
	damageTwoHanded: HashedPlanText | null;
	range: HashedPlanText | null;
	properties: HashedPlanText[];
	mastery: HashedPlanText | null;
	cost: HashedPlanText | null;
	weight: number | null;
}

export type MarkdownBlockSignature =
	| {
		type: 'paragraph';
		markdown: HashedPlanText;
	}
	| {
		type: 'heading';
		level: 2 | 3;
		markdown: HashedPlanText;
	}
	| {
		type: 'unordered-list' | 'ordered-list';
		items: HashedPlanText[];
	}
	| {
		type: 'table';
		headers: HashedPlanText[];
		rows: HashedPlanText[][];
	};

/**
 * Produces a deterministic, text-safe description of canonical physical pages.
 * Text is hashed so regression diagnostics do not expose source rules content.
 */
export function createItemCardPlanSignature(
	pages: readonly ItemCardPage[],
): ItemCardPlanSignature {
	return {
		version: ITEM_CARD_PLAN_SIGNATURE_VERSION,
		physicalProfile: {
			widthMm: PHYSICAL_CARD_PROFILE.widthMm,
			heightMm: PHYSICAL_CARD_PROFILE.heightMm,
			widthPx: PHYSICAL_CARD_PROFILE.widthPx,
			heightPx: PHYSICAL_CARD_PROFILE.heightPx,
			dpi: PHYSICAL_CARD_PROFILE.dpi,
		},
		pageCount: pages.length,
		pages: pages.map(createPageSignature),
	};
}

export function serializeItemCardPlanSignature(
	pages: readonly ItemCardPage[],
): string {
	return JSON.stringify(createItemCardPlanSignature(pages));
}

export function createFittedItemCardPlanSignature(
	plan: FittedItemCardPlanLike,
): FittedItemCardPlanSignature {
	const unfitPageIndexes = [...plan.unfitPageIndexes].sort((left, right) => left - right);
	return {
		plan: createItemCardPlanSignature(plan.pages),
		capacityScale: plan.capacityScale,
		bodyFontPoints: plan.bodyFontPoints,
		unfitPageIndexes,
		exportable: unfitPageIndexes.length === 0,
		artworkResult: {
			status: plan.artworkResult.status,
			orientation: plan.artworkResult.orientation ?? null,
		},
	};
}

export function serializeFittedItemCardPlanSignature(
	plan: FittedItemCardPlanLike,
): string {
	return JSON.stringify(createFittedItemCardPlanSignature(plan));
}

function createPageSignature(page: ItemCardPage): ItemCardPageSignature {
	return {
		item: createItemSignature(page.item),
		pageIndex: page.pageIndex,
		pageCount: page.pageCount,
		kind: page.kind,
		title: hashPlanText(page.title),
		blocks: page.blocks.map(createBlockSignature),
		layout: page.layout,
		bodyFontPoints: page.bodyFontPoints ?? null,
		artworkSharePercent: page.artworkSharePercent ?? null,
		showArtwork: page.showArtwork,
		showStats: page.showStats,
		statsPresentation: page.statsPresentation ?? null,
		showSource: page.showSource,
		artworkOrientation: page.artworkOrientation ?? null,
		hasUnsplitOverflow: page.hasUnsplitOverflow,
	};
}

function createItemSignature(item: ItemCardData): ItemCardPlanItemSignature {
	return {
		filePath: hashPlanText(item.filePath),
		name: hashPlanText(item.name),
		description: hashPlanText(item.description),
		detail: hashOptionalPlanText(item.detail),
		imagePath: hashOptionalPlanText(item.imagePath),
		sourceText: hashOptionalPlanText(item.sourceText),
		hasImage: item.hasImage,
		rarity: hashOptionalPlanText(item.rarity),
		attunement: item.attunement ?? null,
		source: hashOptionalPlanText(item.source),
		damage: hashOptionalPlanText(item.damage),
		damageTwoHanded: hashOptionalPlanText(item.damageTwoHanded),
		range: hashOptionalPlanText(item.range),
		properties: (item.properties ?? []).map(hashPlanText),
		mastery: hashOptionalPlanText(item.mastery),
		cost: hashOptionalPlanText(item.cost),
		weight: item.weight ?? null,
	};
}

function createBlockSignature(block: MarkdownBlock): MarkdownBlockSignature {
	switch (block.type) {
		case 'heading':
			return {
				type: block.type,
				level: block.level,
				markdown: hashPlanText(block.markdown),
			};
		case 'unordered-list':
		case 'ordered-list':
			return {
				type: block.type,
				items: block.items.map(hashPlanText),
			};
		case 'table':
			return {
				type: block.type,
				headers: block.headers.map(hashPlanText),
				rows: block.rows.map((row) => row.map(hashPlanText)),
			};
		case 'paragraph':
			return {
				type: block.type,
				markdown: hashPlanText(block.markdown),
			};
	}
}

function hashOptionalPlanText(value: string | undefined): HashedPlanText | null {
	return value === undefined ? null : hashPlanText(value);
}

function hashPlanText(value: string): HashedPlanText {
	let hash = 0xcbf29ce484222325n;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= BigInt(value.charCodeAt(index));
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return {
		length: value.length,
		hash: hash.toString(16).padStart(16, '0'),
	};
}
