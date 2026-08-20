import type {
	CardArtworkOverride,
	CardOverrides,
	CardStatOverrides,
} from '../models/card-overrides';
import { MANUAL_CARD_BREAK_DELIMITER } from '../models/card-overrides';
import type { ItemCardData } from '../models/item';

export interface AppliedCardOverrides {
	item: ItemCardData;
	overrides: CardOverrides | undefined;
	fingerprint: string;
}

export function applyCardOverrides(
	baseItem: ItemCardData,
	value: unknown,
): AppliedCardOverrides {
	const overrides = normalizeCardOverrides(value);
	if (!overrides) {
		return { item: baseItem, overrides: undefined, fingerprint: 'none' };
	}
	const rulesMarkdown = overrides?.rulesMarkdown ?? baseItem.description;
	const segments = splitManualCardBreaks(rulesMarkdown);
	const stats = overrides?.stats;
	const artwork = overrides?.artwork;
	const hasIdentityOverride = overrides.typeText !== undefined
		|| overrides.rarityText !== undefined
		|| overrides.attunementText !== undefined;
	const item: ItemCardData = {
		...baseItem,
		name: overrides?.title ?? baseItem.name,
		description: segments.join('\n\n'),
		...(hasIdentityOverride ? {
			typeText: overrides.typeText !== undefined
				? overrides.typeText ?? ''
				: inferSourceTypeText(baseItem),
			rarityText: overrides.rarityText !== undefined
				? overrides.rarityText ?? ''
				: baseItem.rarity ? humanizeSlug(baseItem.rarity) : '',
			attunementText: overrides.attunementText !== undefined
				? overrides.attunementText ?? ''
				: baseItem.attunement ? 'Requires attunement' : '',
		} : {}),
		...(segments.length > 1 ? { manualRuleSegments: segments } : {}),
		...(overrides?.sourceText !== undefined
			? {
				sourceText: overrides.sourceText ?? undefined,
				...(overrides.sourceText === null ? { source: undefined } : {}),
			}
			: {}),
		...(stats?.damage !== undefined ? { damage: stats.damage ?? undefined } : {}),
		...(stats?.damageTwoHanded !== undefined
			? { damageTwoHanded: stats.damageTwoHanded ?? undefined }
			: {}),
		...(stats?.range !== undefined ? { range: stats.range ?? undefined } : {}),
		...(stats?.properties !== undefined
			? { properties: stats.properties ?? undefined }
			: {}),
		...(stats?.mastery !== undefined ? { mastery: stats.mastery ?? undefined } : {}),
		...(stats?.cost !== undefined ? { cost: stats.cost ?? undefined } : {}),
		...(stats?.weight !== undefined ? { weight: stats.weight ?? undefined } : {}),
		...(artwork?.kind === 'vault'
			? { imagePath: artwork.path, hasImage: true }
			: artwork?.kind === 'none'
				? { imagePath: undefined, hasImage: false }
				: {}),
	};
	return { item, overrides, fingerprint: createCardOverridesFingerprint(overrides) };
}

export function splitManualCardBreaks(markdown: string): string[] {
	const segments = markdown
		.split(new RegExp(`^[ \\t]*${escapeRegExp(MANUAL_CARD_BREAK_DELIMITER)}[ \\t]*$`, 'gmu'))
		.map((segment) => segment.trim());
	return segments.length > 1 ? segments : [markdown.trim()];
}

export function normalizeCardOverrides(value: unknown): CardOverrides | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const normalized: CardOverrides = {};
	assignTrimmedString(normalized, 'title', value.title, false);
	assignTrimmedString(normalized, 'typeText', value.typeText, true);
	assignTrimmedString(normalized, 'rarityText', value.rarityText, true);
	assignTrimmedString(normalized, 'attunementText', value.attunementText, true);
	if (typeof value.rulesMarkdown === 'string') {
		normalized.rulesMarkdown = value.rulesMarkdown.trim();
	}
	assignTrimmedString(normalized, 'sourceText', value.sourceText, true);

	const stats = normalizeStats(value.stats);
	if (stats) {
		normalized.stats = stats;
	}
	const artwork = normalizeArtwork(value.artwork);
	if (artwork) {
		normalized.artwork = artwork;
	}
	if (isRecord(value.variant) && typeof value.variant.id === 'string') {
		const id = value.variant.id.trim();
		if (id) {
			normalized.variant = { id };
		}
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createCardOverridesFingerprint(value: unknown): string {
	const overrides = normalizeCardOverrides(value);
	if (!overrides) {
		return 'none';
	}
	return JSON.stringify({
		revision: 'card-overrides-v1',
		title: encodeOptional(overrides, 'title'),
		typeText: encodeOptional(overrides, 'typeText'),
		rarityText: encodeOptional(overrides, 'rarityText'),
		attunementText: encodeOptional(overrides, 'attunementText'),
		rulesMarkdown: encodeOptional(overrides, 'rulesMarkdown'),
		stats: overrides.stats ? {
			damage: encodeOptional(overrides.stats, 'damage'),
			damageTwoHanded: encodeOptional(overrides.stats, 'damageTwoHanded'),
			range: encodeOptional(overrides.stats, 'range'),
			properties: encodeOptional(overrides.stats, 'properties'),
			mastery: encodeOptional(overrides.stats, 'mastery'),
			cost: encodeOptional(overrides.stats, 'cost'),
			weight: encodeOptional(overrides.stats, 'weight'),
		} : null,
		artwork: overrides.artwork?.kind === 'vault'
			? { kind: 'vault', path: overrides.artwork.path }
			: overrides.artwork?.kind === 'none' ? { kind: 'none' } : null,
		sourceText: encodeOptional(overrides, 'sourceText'),
		variant: overrides.variant?.id ?? null,
	});
}

function encodeOptional<T extends object, K extends keyof T>(
	value: T,
	key: K,
): object {
	if (!Object.prototype.hasOwnProperty.call(value, key)) {
		return { state: 'inherit' };
	}
	const field = value[key];
	return field === null
		? { state: 'clear' }
		: { state: 'value', value: Array.isArray(field) ? [...field] : field };
}

export function areCardOverridesEqual(left: unknown, right: unknown): boolean {
	return createCardOverridesFingerprint(left) === createCardOverridesFingerprint(right);
}

function normalizeStats(value: unknown): CardStatOverrides | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const stats: CardStatOverrides = {};
	assignTrimmedString(stats, 'damage', value.damage, true);
	assignTrimmedString(stats, 'damageTwoHanded', value.damageTwoHanded, true);
	assignTrimmedString(stats, 'range', value.range, true);
	assignTrimmedString(stats, 'mastery', value.mastery, true);
	assignTrimmedString(stats, 'cost', value.cost, true);
	if (value.weight === null) {
		stats.weight = null;
	} else if (typeof value.weight === 'number' && Number.isFinite(value.weight)) {
		stats.weight = value.weight;
	}
	if (value.properties === null) {
		stats.properties = null;
	} else if (Array.isArray(value.properties)) {
		stats.properties = value.properties
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return Object.keys(stats).length > 0 ? stats : undefined;
}

function normalizeArtwork(value: unknown): CardArtworkOverride | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.kind === 'none') {
		return { kind: 'none' };
	}
	if (value.kind === 'vault' && typeof value.path === 'string') {
		const path = value.path.trim().replaceAll('\\', '/');
		return path ? { kind: 'vault', path } : undefined;
	}
	return undefined;
}

function assignTrimmedString<T extends object, K extends keyof T>(
	target: T,
	key: K,
	value: unknown,
	allowNull: boolean,
): void {
	if (value === null && allowNull) {
		target[key] = null as T[K];
	} else if (typeof value === 'string') {
		target[key] = value.trim() as T[K];
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function inferSourceTypeText(item: ItemCardData): string {
	if (!item.detail) {
		return '';
	}
	let depth = 0;
	let end = item.detail.length;
	for (let index = 0; index < item.detail.length; index += 1) {
		const character = item.detail[index];
		if (character === '(') {
			depth += 1;
		} else if (character === ')') {
			depth = Math.max(0, depth - 1);
		} else if (character === ',' && depth === 0) {
			end = index;
			break;
		}
	}
	const primary = item.detail.slice(0, end).trim();
	const rarity = item.rarity ? humanizeSlug(item.rarity).toLocaleLowerCase() : '';
	return rarity && primary.toLocaleLowerCase().startsWith(rarity) ? '' : primary;
}

function humanizeSlug(value: string): string {
	const normalized = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
	return normalized ? normalized[0]?.toLocaleUpperCase() + normalized.slice(1) : '';
}
