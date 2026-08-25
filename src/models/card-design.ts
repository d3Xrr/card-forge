import {
	getStructuredItemFieldOrigin,
	type ItemCardData,
} from './item';

export const CARD_THEMES = ['dark', 'light', 'printer-friendly'] as const;
export type CardTheme = typeof CARD_THEMES[number];

export const CARD_ARTWORK_SIZES = ['standard', 'larger', 'minimal', 'hidden'] as const;
export type CardArtworkSize = typeof CARD_ARTWORK_SIZES[number];

export const CARD_DENSITIES = ['standard', 'compact'] as const;
export type CardDensity = typeof CARD_DENSITIES[number];

export const CARD_DESIGN_FIELDS = [
	'damage',
	'damageTwoHanded',
	'properties',
	'mastery',
	'range',
	'weight',
	'cost',
	'source',
] as const;
export type CardDesignField = typeof CARD_DESIGN_FIELDS[number];

export type CardFieldVisibility = Partial<Record<CardDesignField, boolean>>;

/** A resolved, bounded presentation profile. Values remain separate from card content. */
export interface CardDesignProfile {
	theme: CardTheme;
	artworkSize: CardArtworkSize;
	density: CardDensity;
	/** Missing keys retain semantic automatic visibility. */
	fieldVisibility?: CardFieldVisibility;
}

export type CardDesignDefaults = Pick<
	CardDesignProfile,
	'theme' | 'artworkSize' | 'density'
>;

/** Stable fallback for queue and Saved Set snapshots created before 0.7.0. */
export const LEGACY_CARD_DESIGN_PROFILE: Readonly<CardDesignProfile> = Object.freeze({
	theme: 'dark',
	artworkSize: 'standard',
	density: 'standard',
});

export const DEFAULT_CARD_DESIGN_DEFAULTS: Readonly<CardDesignDefaults> = Object.freeze({
	theme: 'dark',
	artworkSize: 'standard',
	density: 'standard',
});

export function createCardDesignProfile(
	defaults: Readonly<CardDesignDefaults> = DEFAULT_CARD_DESIGN_DEFAULTS,
): CardDesignProfile {
	return {
		theme: normalizeEnum(defaults.theme, CARD_THEMES, 'dark'),
		artworkSize: normalizeEnum(defaults.artworkSize, CARD_ARTWORK_SIZES, 'standard'),
		density: normalizeEnum(defaults.density, CARD_DENSITIES, 'standard'),
	};
}

export function normalizeCardDesignProfile(
	value: unknown,
	fallback: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): CardDesignProfile {
	if (!isRecord(value)) {
		return cloneCardDesignProfile(fallback);
	}
	const fieldVisibility = normalizeCardFieldVisibility(value.fieldVisibility);
	return {
		theme: normalizeEnum(value.theme, CARD_THEMES, fallback.theme),
		artworkSize: normalizeEnum(
			value.artworkSize,
			CARD_ARTWORK_SIZES,
			fallback.artworkSize,
		),
		density: normalizeEnum(value.density, CARD_DENSITIES, fallback.density),
		...(fieldVisibility ? { fieldVisibility } : {}),
	};
}

export function cloneCardDesignProfile(
	profile: Readonly<CardDesignProfile>,
): CardDesignProfile {
	return {
		theme: profile.theme,
		artworkSize: profile.artworkSize,
		density: profile.density,
		...(profile.fieldVisibility
			? { fieldVisibility: { ...profile.fieldVisibility } }
			: {}),
	};
}

export function areCardDesignProfilesEqual(
	left: Readonly<CardDesignProfile> | undefined,
	right: Readonly<CardDesignProfile> | undefined,
): boolean {
	return createCardDesignFingerprint(left)
		=== createCardDesignFingerprint(right);
}

export function createCardDesignFingerprint(
	profile: Readonly<CardDesignProfile> | undefined,
): string {
	return JSON.stringify(toCanonicalDesign(profile));
}

/** Only state that can alter fit, pagination, or physical layout. */
export function createLayoutDesignFingerprint(
	profile: Readonly<CardDesignProfile> | undefined,
): string {
	const normalized = normalizeCardDesignProfile(profile);
	return JSON.stringify({
		artworkSize: normalized.artworkSize,
		density: normalized.density,
		fieldVisibility: canonicalFieldVisibility(normalized.fieldVisibility),
	});
}

/** Pixel-affecting state. Theme is included even though it does not alter geometry. */
export function createVisualDesignFingerprint(
	profile: Readonly<CardDesignProfile> | undefined,
): string {
	return createCardDesignFingerprint(profile);
}

export function setCardDesignFieldVisibility(
	profile: Readonly<CardDesignProfile>,
	field: CardDesignField,
	visible: boolean,
): CardDesignProfile {
	return normalizeCardDesignProfile({
		...profile,
		fieldVisibility: {
			...profile.fieldVisibility,
			[field]: visible,
		},
	});
}

export function clearCardDesignFieldVisibility(
	profile: Readonly<CardDesignProfile>,
): CardDesignProfile {
	const next = cloneCardDesignProfile(profile);
	delete next.fieldVisibility;
	return next;
}

export function isCardDesignFieldVisible(
	item: ItemCardData,
	field: CardDesignField,
	profile: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): boolean {
	const override = profile.fieldVisibility?.[field];
	if (field === 'source') {
		return override ?? true;
	}
	if (override !== undefined) {
		return override && isCardDesignFieldMeaningful(item, field);
	}
	return isCardDesignFieldAutomaticallyVisible(item, field);
}

export function isCardDesignFieldAutomaticallyVisible(
	item: ItemCardData,
	field: CardDesignField,
): boolean {
	if (field === 'source') {
		return true;
	}
	if (!isCardDesignFieldMeaningful(item, field)) {
		return false;
	}
	return field !== 'cost' || getStructuredItemFieldOrigin(item, 'cost') !== 'base';
}

export function isCardDesignFieldMeaningful(
	item: ItemCardData,
	field: CardDesignField,
): boolean {
	switch (field) {
		case 'damage':
			return Boolean(item.damage?.trim());
		case 'damageTwoHanded':
			return Boolean(item.damageTwoHanded?.trim());
		case 'properties':
			return Boolean(item.properties?.some((property) => property.trim()));
		case 'mastery':
			return Boolean(item.mastery?.trim());
		case 'range':
			return Boolean(item.range?.trim());
		case 'weight':
			return item.weight !== undefined;
		case 'cost':
			return Boolean(item.cost?.trim());
		case 'source':
			return Boolean(
				item.sourceDisplayOverride?.trim()
				|| item.sourceText?.trim()
				|| item.source?.trim(),
			);
	}
}

function normalizeCardFieldVisibility(value: unknown): CardFieldVisibility | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const normalized: CardFieldVisibility = {};
	for (const field of CARD_DESIGN_FIELDS) {
		if (typeof value[field] === 'boolean') {
			normalized[field] = value[field];
		}
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toCanonicalDesign(profile: Readonly<CardDesignProfile> | undefined): object {
	const normalized = normalizeCardDesignProfile(profile);
	return {
		theme: normalized.theme,
		artworkSize: normalized.artworkSize,
		density: normalized.density,
		fieldVisibility: canonicalFieldVisibility(normalized.fieldVisibility),
	};
}

function canonicalFieldVisibility(
	visibility: Readonly<CardFieldVisibility> | undefined,
): Record<string, boolean> {
	return Object.fromEntries(CARD_DESIGN_FIELDS.flatMap((field) =>
		typeof visibility?.[field] === 'boolean'
			? [[field, visibility[field]]]
			: [],
	));
}

function normalizeEnum<T extends string>(
	value: unknown,
	values: readonly T[],
	fallback: T,
): T {
	return typeof value === 'string' && values.includes(value as T)
		? value as T
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
