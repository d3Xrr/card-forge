import type { CardOverrides } from '../models/card-overrides';
import type { ItemCardData } from '../models/item';
import {
	applyCardOverrides,
	createCardOverridesFingerprint,
	normalizeCardOverrides,
} from './card-overrides';
import {
	discoverItemVariants,
	type ItemCardVariant,
} from './item-variants';

export interface EffectiveCardInput {
	source: ItemCardData;
	item: ItemCardData;
	overrides?: CardOverrides;
	overrideFingerprint: string;
	variant?: ItemCardVariant;
}

/** Resolves only the overrides explicitly supplied for this card context. */
export function createEffectiveCardInput(
	source: ItemCardData,
	indexedItems: readonly ItemCardData[],
	overrides: CardOverrides | undefined,
): EffectiveCardInput {
	const normalized = normalizeCardOverrides(overrides);
	const variants = discoverItemVariants(source, indexedItems);
	const variant = variants.find((candidate) => candidate.id === normalized?.variant?.id);
	const applied = applyCardOverrides(variant?.item ?? source, normalized);
	return {
		source,
		item: applied.item,
		...(applied.overrides ? { overrides: applied.overrides } : {}),
		overrideFingerprint: createCardOverridesFingerprint(applied.overrides),
		...(variant ? { variant } : {}),
	};
}
