import type { ItemCardPage } from '../models/item-card-page';
import { serializeItemCardPlanSignature } from '../renderer/item-card-plan-signature';

export const CARD_RASTER_CACHE_REVISION = 'card-raster-v2';

export interface CardRasterIdentityInput {
	page: ItemCardPage;
	physicalPlanKey?: string;
	artworkResourcePath?: string;
	artworkRevisionFingerprint?: string;
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
		artwork: {
			resourcePath: input.artworkResourcePath ?? null,
			revisionFingerprint: input.artworkRevisionFingerprint ?? null,
		},
	});
}
