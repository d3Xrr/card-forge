import type { ArtworkOrientation } from '../models/item-card-page';

export type { ArtworkOrientation } from '../models/item-card-page';

export const ARTWORK_ORIENTATION_RATIO_THRESHOLD = 1.35;
export const ITEM_ARTWORK_FIT_MODE = 'contain' as const;

export function classifyArtworkOrientation(
	width: number,
	height: number,
): ArtworkOrientation | undefined {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return undefined;
	}

	if (height / width > ARTWORK_ORIENTATION_RATIO_THRESHOLD) {
		return 'portrait';
	}
	if (width / height > ARTWORK_ORIENTATION_RATIO_THRESHOLD) {
		return 'landscape';
	}
	return 'square';
}

export function formatArtworkOrientation(orientation: ArtworkOrientation): string {
	return orientation.toLocaleUpperCase();
}
