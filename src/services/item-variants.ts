import type { ItemCardData } from '../models/item';

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
	const itemsByName = new Map(
		indexedItems.map((item) => [normalizeLookupName(item.name), item]),
	);
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
			itemsByName,
		);
		const baseName = baseItem?.name ?? inferredBaseName;
		const parsed = parseVariantSection(sectionMarkdown);
		const base = baseItem ?? source;
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
				...(base.detail ? { typeText: base.detail } : {}),
				...(source.rarity ? { rarityText: formatRarity(source.rarity) } : {}),
				...(source.attunement ? { attunementText: 'Requires attunement' } : {}),
				...copyBaseStats(base),
				...parsed.stats,
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
	itemsByName: ReadonlyMap<string, ItemCardData>,
): ItemCardData | undefined {
	if (inferredBaseName) {
		const exact = itemsByName.get(normalizeLookupName(inferredBaseName));
		if (exact && exact.filePath !== source.filePath) {
			return exact;
		}
	}
	const inferred = normalizeLookupName(inferredBaseName ?? label);
	const normalizedLabel = normalizeLookupName(label);
	return items
		.filter((item) => item.filePath !== source.filePath)
		.filter((item) => {
			const candidate = normalizeLookupName(item.name);
			return inferred.startsWith(`${candidate} `)
				|| normalizedLabel.endsWith(` ${candidate}`);
		})
		.sort((left, right) => right.name.length - left.name.length)[0];
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

function copyBaseStats(item: ItemCardData): Partial<ItemCardData> {
	return {
		...(item.damage ? { damage: item.damage } : {}),
		...(item.damageTwoHanded ? { damageTwoHanded: item.damageTwoHanded } : {}),
		...(item.range ? { range: item.range } : {}),
		...(item.properties ? { properties: [...item.properties] } : {}),
		...(item.mastery ? { mastery: item.mastery } : {}),
		...(item.cost ? { cost: item.cost } : {}),
		...(item.weight !== undefined ? { weight: item.weight } : {}),
	};
}

function formatRarity(value: string): string {
	return value
		.replaceAll('_', ' ')
		.replaceAll('-', ' ')
		.replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
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
