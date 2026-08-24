import type {
	ItemCardData,
	StructuredItemField,
	StructuredItemFieldOrigin,
} from '../models/item';
import {
	formatItemRarity,
	getSemanticItemTypeText,
	getSourceAttunementText,
} from './item-identity';

export interface ItemCardVariant {
	id: string;
	label: string;
	baseName?: string;
	baseItem?: ItemCardData;
	sectionMarkdown: string;
	item: ItemCardData;
}

const VARIANTS_MARKER = /^\s*\*\*Variants\*\*\s*:\s*$/imu;
const VARIANT_HEADING = /^###\s+(.+?)\s*$/gmu;

/** Discovers same-note H3 variants without depending on any particular item. */
export function discoverItemVariants(
	source: ItemCardData,
	indexedItems: readonly ItemCardData[],
): ItemCardVariant[] {
	const marker = VARIANTS_MARKER.exec(source.description);
	if (!marker) {
		return [];
	}
	const magicRules = source.description.slice(0, marker.index).trim();
	const variantRegion = source.description.slice(marker.index + marker[0].length);
	const headings = [...variantRegion.matchAll(VARIANT_HEADING)];
	const variants: ItemCardVariant[] = [];
	for (const [index, heading] of headings.entries()) {
		const label = heading[1]?.trim();
		if (!label || heading.index === undefined) {
			continue;
		}
		const sectionStart = heading.index + heading[0].length;
		const sectionEnd = headings[index + 1]?.index ?? variantRegion.length;
		const sectionMarkdown = variantRegion.slice(sectionStart, sectionEnd).trim();
		const inferredBaseName = inferVariantBaseName(source.name, label);
		const baseItem = resolveVariantBaseItem(
			source,
			label,
			inferredBaseName,
			indexedItems,
		);
		const baseName = baseItem?.name ?? inferredBaseName;
		const parsed = parseVariantSection(sectionMarkdown);
		const inheritedStats = baseItem
			? inheritMissingBaseStats(source, baseItem)
			: {};
		const typeText = getSemanticItemTypeText(baseItem ?? source);
		const rarityText = source.rarityText
			?? (source.rarity ? formatItemRarity(source.rarity) : '');
		const attunementText = getSourceAttunementText(source);
		const structuredFieldOrigins = createVariantFieldOrigins(
			source,
			baseItem,
			inheritedStats,
			parsed.stats,
			typeText,
			rarityText,
			attunementText,
		);
		const description = [magicRules, parsed.rulesMarkdown]
			.filter(Boolean)
			.join('\n\n');
		variants.push({
			id: createVariantId(label),
			label,
			...(baseName ? { baseName } : {}),
			...(baseItem ? { baseItem } : {}),
			sectionMarkdown,
			item: {
				...source,
				name: label,
				description,
				...(typeText ? { typeText } : {}),
				...(rarityText ? { rarityText } : {}),
				...(attunementText ? { attunementText } : {}),
				...inheritedStats,
				...parsed.stats,
				...(Object.keys(structuredFieldOrigins).length > 0
					? { structuredFieldOrigins }
					: {}),
			},
		});
	}
	return variants;
}

function resolveVariantBaseItem(
	source: ItemCardData,
	label: string,
	inferredBaseName: string | undefined,
	items: readonly ItemCardData[],
): ItemCardData | undefined {
	const inferred = inferredBaseName ? normalizeLookupName(inferredBaseName) : '';
	const normalizedLabel = normalizeLookupName(label);
	const labelWithoutBonus = stripMagicBonus(normalizedLabel);
	return items
		.filter((item) => item.filePath !== source.filePath)
		.map((item) => ({ item, score: scoreBaseCandidate(
			item,
			inferred,
			normalizedLabel,
			labelWithoutBonus,
		) }))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score)[0]?.item;
}

export function selectItemVariant(
	source: ItemCardData,
	items: readonly ItemCardData[],
	variantId: string | undefined,
): ItemCardVariant | undefined {
	return discoverItemVariants(source, items).find((variant) => variant.id === variantId);
}

/** Concise UI label only; variant identity and generated item title are unchanged. */
export function getVariantDisplayLabel(variant: ItemCardVariant): string {
	return variant.baseItem?.name ?? variant.label;
}

export function createVariantId(label: string): string {
	return label
		.normalize('NFKD')
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
}

export function inferVariantBaseName(sourceName: string, variantLabel: string): string | undefined {
	const source = sourceName.trim();
	const label = variantLabel.trim();
	const bonusPrefix = source.match(/^([+-]\d+)\s+/u)?.[1];
	if (bonusPrefix && label.startsWith(`${bonusPrefix} `)) {
		return label.slice(bonusPrefix.length + 1).trim() || undefined;
	}
	const sourcePrefix = `${source} `;
	if (label.toLocaleLowerCase().startsWith(sourcePrefix.toLocaleLowerCase())) {
		return label.slice(sourcePrefix.length).trim() || undefined;
	}
	return undefined;
}

interface ParsedVariantSection {
	rulesMarkdown: string;
	stats: Partial<ItemCardData>;
}

function parseVariantSection(markdown: string): ParsedVariantSection {
	const stats: Partial<ItemCardData> = {};
	const retained: string[] = [];
	for (const line of markdown.split(/\r?\n/gu)) {
		const match = line.match(
			/^\s*(?:[-*]\s+)?(?:\*\*)?([^:*]+?)(?:\*\*)?\s*:\s*(.*?)\s*$/u,
		);
		if (!match) {
			retained.push(line);
			continue;
		}
		const label = match[1]?.trim().toLocaleLowerCase();
		const value = match[2]?.trim() ?? '';
		if (assignVariantStat(stats, label, value)) {
			continue;
		}
		retained.push(line);
	}
	return { rulesMarkdown: trimBlankLines(retained).join('\n'), stats };
}

function assignVariantStat(
	stats: Partial<ItemCardData>,
	label: string | undefined,
	value: string,
): boolean {
	if (!label) {
		return false;
	}
	const clean = cleanInlineValue(value);
	switch (label) {
		case 'damage':
			if (clean) {
				stats.damage = clean;
			}
			return true;
		case 'one-handed':
		case 'one handed':
		case 'one-handed damage':
		case 'one handed damage':
			stats.damage = clean;
			return true;
		case 'two-handed damage':
		case 'two handed damage':
		case 'two-handed':
		case 'two handed':
		case 'damage (two-handed)':
			stats.damageTwoHanded = clean;
			return true;
		case 'range':
			stats.range = clean;
			return true;
		case 'properties':
			stats.properties = clean.split(/\s*,\s*/u).filter(Boolean);
			return true;
		case 'mastery':
			stats.mastery = clean;
			return true;
		case 'cost':
			stats.cost = clean;
			return true;
		case 'weight': {
			const numericWeight = Number.parseFloat(clean);
			if (Number.isFinite(numericWeight)) {
				stats.weight = numericWeight;
			}
			return true;
		}
		default:
			return false;
	}
}

function cleanInlineValue(value: string): string {
	return value
		.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
		.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match, target: string, alias?: string) => alias ?? target)
		.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
		.replace(/[*_`]/gu, '')
		.trim();
}

const STAT_FIELDS = [
	'damage',
	'damageTwoHanded',
	'range',
	'properties',
	'mastery',
	'cost',
	'weight',
] as const satisfies readonly StructuredItemField[];

function inheritMissingBaseStats(
	source: ItemCardData,
	base: ItemCardData,
): Partial<ItemCardData> {
	const inherited: Partial<ItemCardData> = {};
	for (const field of STAT_FIELDS) {
		if (source[field] !== undefined || base[field] === undefined) {
			continue;
		}
		if (field === 'properties') {
			inherited.properties = [...(base.properties ?? [])];
		} else {
			assignItemField(inherited, field, base[field]);
		}
	}
	return inherited;
}

function createVariantFieldOrigins(
	source: ItemCardData,
	baseItem: ItemCardData | undefined,
	inheritedStats: Partial<ItemCardData>,
	parsedStats: Partial<ItemCardData>,
	typeText: string,
	rarityText: string,
	attunementText: string,
): Partial<Record<StructuredItemField, StructuredItemFieldOrigin>> {
	const origins = { ...(source.structuredFieldOrigins ?? {}) };
	if (typeText) {
		origins.typeText = baseItem ? 'base' : 'source';
	}
	if (rarityText) {
		origins.rarityText = 'source';
	}
	if (attunementText) {
		origins.attunementText = 'source';
	}
	markPresentFieldOrigins(origins, inheritedStats, 'base');
	markPresentFieldOrigins(origins, parsedStats, 'source');
	return origins;
}

function markPresentFieldOrigins(
	origins: Partial<Record<StructuredItemField, StructuredItemFieldOrigin>>,
	item: Partial<ItemCardData>,
	origin: StructuredItemFieldOrigin,
): void {
	for (const field of STAT_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(item, field)) {
			origins[field] = origin;
		}
	}
}

function assignItemField<K extends Exclude<(typeof STAT_FIELDS)[number], 'properties'>>(
	item: Partial<ItemCardData>,
	field: K,
	value: ItemCardData[K],
): void {
	item[field] = value;
}

function scoreBaseCandidate(
	item: ItemCardData,
	inferred: string,
	label: string,
	labelWithoutBonus: string,
): number {
	const candidate = normalizeLookupName(item.name);
	let matchScore = 0;
	if (inferred && candidate === inferred) {
		matchScore = 500;
	} else if (candidate === label || candidate === labelWithoutBonus) {
		matchScore = 480;
	} else if (
		label.startsWith(`${candidate} `)
		|| labelWithoutBonus.startsWith(`${candidate} `)
	) {
		matchScore = 400;
	} else if (
		label.endsWith(` ${candidate}`)
		|| labelWithoutBonus.endsWith(` ${candidate}`)
	) {
		matchScore = 380;
	}
	if (matchScore === 0) {
		return 0;
	}
	const mundaneBonus = item.rarity ? 0 : 200;
	const equipmentBonus = /^(?:weapon|armor)\b/iu.test(getSemanticItemTypeText(item)) ? 20 : 0;
	return matchScore + mundaneBonus + equipmentBonus + candidate.length / 1000;
}

function stripMagicBonus(value: string): string {
	return value
		.replace(/^[+-]\d+\s+/u, '')
		.replace(/\s+[+-]\d+$/u, '')
		.trim();
}

function normalizeLookupName(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function trimBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start]?.trim()) {
		start += 1;
	}
	while (end > start && !lines[end - 1]?.trim()) {
		end -= 1;
	}
	return lines.slice(start, end);
}
