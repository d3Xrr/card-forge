import type { ItemCardData } from '../models/item';

export type ItemCardLayout = 'image' | 'compact' | 'text';

const IMAGE_LAYOUT_MAX_LOAD = 11;
const COMPACT_LAYOUT_MAX_LOAD = 22;

export function selectItemCardLayout(item: ItemCardData): ItemCardLayout {
	if (!item.hasImage) {
		return 'text';
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
