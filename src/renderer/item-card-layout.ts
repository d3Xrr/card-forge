import type { ItemCardData } from '../models/item';
import type {
	ArtworkOrientation,
	ItemCardLayout,
} from '../models/item-card-page';
import {
	PRINT_TYPOGRAPHY,
	printPointsToCardWidthCqw,
} from './print-typography';

export type { ItemCardLayout } from '../models/item-card-page';

export interface ItemCardLayoutProfile {
	artworkSharePercent: number;
	bodyFontCqw: number;
	printFontPoints: number;
}

export const MINIMUM_PRINT_BODY_FONT_POINTS = PRINT_TYPOGRAPHY.body.minimumPoints;

export const ADAPTIVE_BODY_FONT_POINTS = Object.freeze([
	10,
	9.5,
	9,
	8.5,
	8,
	7.5,
	7,
] as const);

const LAYOUT_PROFILE_VALUES: Record<
	ItemCardLayout,
	{ artworkSharePercent: number; printFontPoints: number }
> = {
	image: {
		artworkSharePercent: 43,
		printFontPoints: 10,
	},
	portrait: {
		artworkSharePercent: 32,
		printFontPoints: 9,
	},
	compact: {
		artworkSharePercent: 24,
		printFontPoints: 9,
	},
	text: {
		artworkSharePercent: 0,
		printFontPoints: MINIMUM_PRINT_BODY_FONT_POINTS,
	},
};

const IMAGE_LAYOUT_MAX_LOAD = 11;
const COMPACT_LAYOUT_MAX_LOAD = 22;

export function selectItemCardLayout(
	item: ItemCardData,
	artworkOrientation?: ArtworkOrientation,
): ItemCardLayout {
	if (!item.hasImage) {
		return 'text';
	}
	if (artworkOrientation === 'portrait') {
		return 'portrait';
	}

	const load = estimateDescriptionLoad(item.description);
	if (load <= IMAGE_LAYOUT_MAX_LOAD) {
		return 'image';
	}
	if (load <= COMPACT_LAYOUT_MAX_LOAD) {
		return 'compact';
	}
	return 'text';
}

export function estimateDescriptionLoad(markdown: string): number {
	const lines = markdown.replaceAll('\r\n', '\n').split('\n');
	let load = 0;
	let previousLineWasContent = false;

	for (const line of lines) {
		const visibleText = line
			.replace(/[*_`~]/gu, '')
			.replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, '')
			.trim();

		if (visibleText.length === 0) {
			if (previousLineWasContent) {
				load += 0.65;
			}
			previousLineWasContent = false;
			continue;
		}

		const isListItem = /^\s*(?:[-+*]|\d+[.)])\s+/u.test(line);
		const approximateLineWidth = isListItem ? 35 : 44;
		load += Math.max(1, Math.ceil(visibleText.length / approximateLineWidth));
		if (isListItem) {
			load += 0.45;
		}
		previousLineWasContent = true;
	}

	return load;
}

export function formatLayoutName(layout: ItemCardLayout): string {
	return layout.toLocaleUpperCase();
}

export function selectPreferredBodyFontPoints(markdown: string): number {
	const load = estimateDescriptionLoad(markdown);
	if (load <= 6) {
		return 10;
	}
	if (load <= 12) {
		return 9.5;
	}
	if (load <= 18) {
		return 9;
	}
	if (load <= 24) {
		return 8.5;
	}
	if (load <= 32) {
		return 8;
	}
	if (load <= 42) {
		return 7.5;
	}
	return MINIMUM_PRINT_BODY_FONT_POINTS;
}

export function getAdaptiveBodyFontCandidates(): number[] {
	return [...ADAPTIVE_BODY_FONT_POINTS];
}

export function getItemCardLayoutProfile(
	layout: ItemCardLayout,
	bodyFontPoints = LAYOUT_PROFILE_VALUES[layout].printFontPoints,
	usesCompactStats = false,
	artworkShareOverride?: number,
): ItemCardLayoutProfile {
	const values = LAYOUT_PROFILE_VALUES[layout];
	const safeBodyFontPoints = Math.min(
		PRINT_TYPOGRAPHY.body.targetPoints,
		Math.max(MINIMUM_PRINT_BODY_FONT_POINTS, bodyFontPoints),
	);
	const defaultArtworkSharePercent = layout === 'image' && usesCompactStats
		? 34
		: values.artworkSharePercent;
	const artworkSharePercent = artworkShareOverride === undefined
		? defaultArtworkSharePercent
		: Math.min(defaultArtworkSharePercent, Math.max(16, artworkShareOverride));
	return {
		artworkSharePercent,
		printFontPoints: safeBodyFontPoints,
		bodyFontCqw: roundUpCqw(printPointsToCardWidthCqw(safeBodyFontPoints)),
	};
}

function roundUpCqw(cqw: number): number {
	return Math.ceil(cqw * 1000) / 1000;
}
