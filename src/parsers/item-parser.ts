import type { ItemCardData } from '../models/item';

const ITEM_CSS_CLASS = 'json5e-item';
const RARITY_TAG_PREFIX = 'ttrpg-cli/item/rarity/';
const SOURCE_TAG_PREFIX = 'ttrpg-cli/compendium/src/5e/';
const ATTUNEMENT_TAG = 'ttrpg-cli/item/attunement/required';

export type Frontmatter = Record<string, unknown>;

export function isCliItem(frontmatter: Frontmatter | null | undefined): boolean {
	if (!frontmatter) {
		return false;
	}

	return toStringArray(frontmatter.cssclasses).includes(ITEM_CSS_CLASS);
}

export function parseItemFrontmatter(
	filePath: string,
	frontmatter: Frontmatter | null | undefined,
): ItemCardData | null {
	if (!frontmatter || !isCliItem(frontmatter)) {
		return null;
	}

	const tags = toStringArray(frontmatter.tags);
	const name = firstNonEmptyString(frontmatter.name, fileNameWithoutExtension(filePath));
	const detail = optionalString(frontmatter.itemDetail);
	const image = optionalString(frontmatter.image);
	const damage = optionalString(frontmatter.itemDmg);
	const properties = parseLinkedList(frontmatter.itemProp);
	const mastery = optionalString(frontmatter.itemMastery);
	const rarity = findTagValue(tags, RARITY_TAG_PREFIX);
	const source = findTagValue(tags, SOURCE_TAG_PREFIX);
	const weight = toFiniteNumber(frontmatter.itemWeight);

	return {
		filePath,
		name,
		...(detail ? { detail } : {}),
		...(image ? { imagePath: normalizeVaultPath(image) } : {}),
		...(rarity ? { rarity } : {}),
		attunement: tags.includes(ATTUNEMENT_TAG),
		...(source ? { source } : {}),
		...(damage ? { damage } : {}),
		...(properties.length > 0 ? { properties } : {}),
		...(mastery ? { mastery: stripMarkdownLink(mastery) } : {}),
		...(weight !== undefined ? { weight } : {}),
		rawTags: tags,
	};
}

export function normalizeVaultPath(path: string): string {
	const trimmed = path.trim().replaceAll('\\', '/');
	let decoded = trimmed;

	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		// A malformed escape should not make an otherwise usable path disappear.
	}

	return decoded.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function parseLinkedList(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [value];
	const entries = values
		.filter((entry): entry is string => typeof entry === 'string')
		.flatMap((entry) => splitCommaSeparated(entry));
	return entries.map(stripMarkdownLink).filter((entry) => entry.length > 0);
}

function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	if (typeof value === 'string') {
		return value
			.split(/\s+/u)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	return [];
}

function splitCommaSeparated(value: string): string[] {
	const entries: string[] = [];
	let currentEntry = '';
	let nestingDepth = 0;

	for (const character of value) {
		if (character === '[' || character === '(') {
			nestingDepth += 1;
		} else if ((character === ']' || character === ')') && nestingDepth > 0) {
			nestingDepth -= 1;
		}

		if (character === ',' && nestingDepth === 0) {
			entries.push(currentEntry.trim());
			currentEntry = '';
		} else {
			currentEntry += character;
		}
	}

	entries.push(currentEntry.trim());
	return entries;
}

function stripMarkdownLink(value: string): string {
	return value.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').trim();
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function firstNonEmptyString(primary: unknown, fallback: string): string {
	return optionalString(primary) ?? fallback;
}

function fileNameWithoutExtension(path: string): string {
	const fileName = path.replaceAll('\\', '/').split('/').at(-1) ?? path;
	return fileName.replace(/\.md$/iu, '');
}

function findTagValue(tags: string[], prefix: string): string | undefined {
	const matchingTag = tags.find((tag) => tag.startsWith(prefix));
	return matchingTag?.slice(prefix.length) || undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value !== 'number' && typeof value !== 'string') {
		return undefined;
	}

	if (typeof value === 'string' && value.trim().length === 0) {
		return undefined;
	}

	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
