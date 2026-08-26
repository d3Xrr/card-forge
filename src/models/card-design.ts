import {
	getStructuredItemFieldOrigin,
	type ItemCardData,
} from './item';

export const CARD_THEMES = ['dark', 'light', 'printer-friendly'] as const;
export type CardTheme = typeof CARD_THEMES[number];

export const CARD_ARTWORK_SIZES = ['standard', 'larger', 'minimal', 'hidden'] as const;
export type CardArtworkSize = typeof CARD_ARTWORK_SIZES[number];

export const CARD_DENSITIES = ['standard', 'compact', 'auto'] as const;
export type CardDensity = typeof CARD_DENSITIES[number];
export type ResolvedCardDensity = Exclude<CardDensity, 'auto'>;

export const ARTWORK_FIT_MODES = ['fit', 'fill'] as const;
export type ArtworkFitMode = typeof ARTWORK_FIT_MODES[number];

export const CARD_BACK_STYLES = [
	'none',
	'generic',
	'rarity',
	'item-type',
	'artwork',
	'custom-image',
] as const;
export type CardBackStyle = typeof CARD_BACK_STYLES[number];

export interface ArtworkFraming {
	fitMode: ArtworkFitMode;
	/** Bounded multiplier applied inside the planner-owned artwork box. */
	zoom: number;
	/** Bounded percentage-like position controls in the range -100..100. */
	panX: number;
	panY: number;
}

export interface CardBackDesign {
	style: CardBackStyle;
	/** Vault-relative image path used only by the Custom Image style. */
	customArtworkPath?: string;
	artworkFraming: ArtworkFraming;
}

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
	frontArtworkFraming: ArtworkFraming;
	/** Back theme intentionally inherits the bounded front theme in 0.8.0. */
	back: CardBackDesign;
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
	frontArtworkFraming: Object.freeze({ fitMode: 'fit', zoom: 1, panX: 0, panY: 0 }),
	back: Object.freeze({
		style: 'none',
		artworkFraming: Object.freeze({ fitMode: 'fit', zoom: 1, panX: 0, panY: 0 }),
	}),
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
		frontArtworkFraming: createDefaultArtworkFraming(),
		back: createDefaultCardBackDesign(),
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
		frontArtworkFraming: normalizeArtworkFraming(
			value.frontArtworkFraming,
			fallback.frontArtworkFraming,
		),
		back: normalizeCardBackDesign(value.back, fallback.back),
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
		frontArtworkFraming: { ...profile.frontArtworkFraming },
		back: {
			style: profile.back.style,
			...(profile.back.customArtworkPath
				? { customArtworkPath: profile.back.customArtworkPath }
				: {}),
			artworkFraming: { ...profile.back.artworkFraming },
		},
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
	return createFrontVisualDesignFingerprint(profile);
}

/** Pixel identity for a front raster; back-only changes do not rerasterize fronts. */
export function createFrontVisualDesignFingerprint(
	profile: Readonly<CardDesignProfile> | undefined,
): string {
	const normalized = normalizeCardDesignProfile(profile);
	return JSON.stringify({
		theme: normalized.theme,
		artworkSize: normalized.artworkSize,
		density: normalized.density,
		frontArtworkFraming: normalized.frontArtworkFraming,
		fieldVisibility: canonicalFieldVisibility(normalized.fieldVisibility),
	});
}

/** Pixel identity for a back raster; front layout choices are intentionally absent. */
export function createBackVisualDesignFingerprint(
	profile: Readonly<CardDesignProfile> | undefined,
): string {
	const normalized = normalizeCardDesignProfile(profile);
	return JSON.stringify({
		theme: normalized.theme,
		back: {
			style: normalized.back.style,
			...(normalized.back.style === 'custom-image'
				? { customArtworkPath: normalized.back.customArtworkPath ?? null }
				: {}),
			...(normalized.back.style === 'artwork'
				|| normalized.back.style === 'custom-image'
				? { artworkFraming: normalized.back.artworkFraming }
				: {}),
		},
	});
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
		frontArtworkFraming: normalized.frontArtworkFraming,
		back: normalized.back,
		fieldVisibility: canonicalFieldVisibility(normalized.fieldVisibility),
	};
}

export function createDefaultArtworkFraming(): ArtworkFraming {
	return { fitMode: 'fit', zoom: 1, panX: 0, panY: 0 };
}

export function createDefaultCardBackDesign(): CardBackDesign {
	return {
		style: 'none',
		artworkFraming: createDefaultArtworkFraming(),
	};
}

export function normalizeArtworkFraming(
	value: unknown,
	fallback: Readonly<ArtworkFraming> = createDefaultArtworkFraming(),
): ArtworkFraming {
	const input = isRecord(value) ? value : {};
	return {
		fitMode: normalizeEnum(input.fitMode, ARTWORK_FIT_MODES, fallback.fitMode),
		zoom: normalizeBoundedNumber(input.zoom, fallback.zoom, 1, 3),
		panX: normalizeBoundedNumber(input.panX, fallback.panX, -100, 100),
		panY: normalizeBoundedNumber(input.panY, fallback.panY, -100, 100),
	};
}

export function normalizeCardBackDesign(
	value: unknown,
	fallback: Readonly<CardBackDesign> = createDefaultCardBackDesign(),
): CardBackDesign {
	const input = isRecord(value) ? value : {};
	const customArtworkPath = normalizeVaultRelativeArtworkPath(
		input.customArtworkPath,
		fallback.customArtworkPath,
	);
	return {
		style: normalizeEnum(input.style, CARD_BACK_STYLES, fallback.style),
		...(customArtworkPath ? { customArtworkPath } : {}),
		artworkFraming: normalizeArtworkFraming(
			input.artworkFraming,
			fallback.artworkFraming,
		),
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

function normalizeBoundedNumber(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const number = typeof value === 'number' && Number.isFinite(value)
		? value
		: fallback;
	return Math.round(Math.min(maximum, Math.max(minimum, number)) * 100) / 100;
}

function normalizeVaultRelativeArtworkPath(
	value: unknown,
	fallback: string | undefined,
): string | undefined {
	const normalized = (typeof value === 'string' ? value : fallback)
		?.trim()
		.replace(/\\/gu, '/')
		.replace(/^\.\//u, '');
	if (
		!normalized
		|| normalized.startsWith('/')
		|| /^[a-z]:\//iu.test(normalized)
		|| normalized.split('/').some((segment) => segment === '..')
	) {
		return undefined;
	}
	return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
