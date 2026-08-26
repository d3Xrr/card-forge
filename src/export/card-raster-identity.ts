import type { ItemCardPage } from '../models/item-card-page';
import type { CardDesignProfile } from '../models/card-design';
import {
	createBackVisualDesignFingerprint,
	createFrontVisualDesignFingerprint,
} from '../models/card-design';
import { serializeItemCardPlanSignature } from '../renderer/item-card-plan-signature';

export const CARD_RASTER_CACHE_REVISION = 'card-raster-v6-framing';
export const CARD_BACK_RASTER_CACHE_REVISION = 'card-back-raster-v1';

export interface CardRasterIdentityInput {
	page: ItemCardPage;
	physicalPlanKey?: string;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
	design?: CardDesignProfile;
}

/**
 * Identifies the final rendered physical page rather than its source note.
 * Copies of one equivalent page still share a raster within an export, while
 * entry-specific text, layout, statistics, source text, and artwork cannot
 * collide merely because they originated from the same Markdown file.
 */
export function createRasterCacheKey(input: CardRasterIdentityInput): string {
	return JSON.stringify({
		revision: CARD_RASTER_CACHE_REVISION,
		physicalPlanKey: input.physicalPlanKey ?? null,
		pageSignature: serializeItemCardPlanSignature([input.page]),
		visualDesignFingerprint: createFrontVisualDesignFingerprint(input.design),
		artwork: {
			resourcePath: input.artworkResourcePath ?? null,
			revisionFingerprint: input.artworkRevisionFingerprint ?? null,
		},
	});
}

/** Identifies one logical card back; continuation pages intentionally share it. */
export function createBackRasterCacheKey(input: CardRasterIdentityInput): string {
	return JSON.stringify({
		revision: CARD_BACK_RASTER_CACHE_REVISION,
		physicalPlanKey: input.physicalPlanKey ?? null,
		logicalCard: {
			filePath: input.page.item.filePath,
			name: input.page.item.name,
			rarity: input.page.item.rarity ?? null,
			rarityText: input.page.item.rarityText ?? null,
			typeText: input.page.item.typeText ?? null,
			detail: input.page.item.detail ?? null,
		},
		backVisualDesignFingerprint: createBackVisualDesignFingerprint(input.design),
		artwork: {
			resourcePath: input.artworkResourcePath ?? null,
			revisionFingerprint: input.artworkRevisionFingerprint ?? null,
		},
	});
}
