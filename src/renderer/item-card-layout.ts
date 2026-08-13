import type { ItemCardData } from '../models/item';
import { PHYSICAL_CARD_PROFILE } from '../models/physical-card-profile';
import type {
	ArtworkOrientation,
	ItemCardLayout,
} from '../models/item-card-page';

export type { ItemCardLayout } from '../models/item-card-page';

export interface ItemCardLayoutProfile {
	artworkSharePercent: number;
	bodyFontCqw: number;
	printFontPoints: number;
}

export const MINIMUM_PRINT_BODY_FONT_POINTS = 7;
const MINIMUM_BODY_FONT_CQW = roundUpCqw(
	pointsToCardWidthCqw(MINIMUM_PRINT_BODY_FONT_POINTS),
);

const LAYOUT_PROFILE_VALUES: Record<
	ItemCardLayout,
	Omit<ItemCardLayoutProfile, 'printFontPoints'>
> = {
	image: {
		artworkSharePercent: 50,
		bodyFontCqw: 4.35,
	},
	portrait: {
		artworkSharePercent: 34,
		bodyFontCqw: 4,
	},
	compact: {
		artworkSharePercent: 27,
		bodyFontCqw: 4,
	},
	text: {
		artworkSharePercent: 0,
		bodyFontCqw: MINIMUM_BODY_FONT_CQW,
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

export function getItemCardLayoutProfile(layout: ItemCardLayout): ItemCardLayoutProfile {
	const values = LAYOUT_PROFILE_VALUES[layout];
	return {
		...values,
		printFontPoints: cardWidthCqwToPoints(values.bodyFontCqw),
	};
}

function pointsToCardWidthCqw(points: number): number {
	const millimeters = points * 25.4 / 72;
	return millimeters / PHYSICAL_CARD_PROFILE.widthMm * 100;
}

function cardWidthCqwToPoints(cqw: number): number {
	const millimeters = PHYSICAL_CARD_PROFILE.widthMm * cqw / 100;
	return millimeters / 25.4 * 72;
}

function roundUpCqw(cqw: number): number {
	return Math.ceil(cqw * 1000) / 1000;
}
