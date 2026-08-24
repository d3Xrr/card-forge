import type { ItemCardData } from '../models/item';

const ATTUNEMENT_DETAIL = /\(\s*(requires attunement(?:\s+by\s+[^)]+)?)\s*\)/iu;
const WEAPON_TAG_PREFIX = 'ttrpg-cli/item/weapon/';
const ARMOR_TAG_PREFIX = 'ttrpg-cli/item/armor/';

export function getSourceAttunementText(item: ItemCardData): string {
	if (item.attunementText !== undefined) {
		return item.attunementText.trim();
	}
	const qualifier = item.detail?.match(ATTUNEMENT_DETAIL)?.[1]?.trim();
	if (qualifier) {
		return capitalizeFirst(qualifier);
	}
	return item.attunement ? 'Requires attunement' : '';
}

export function getSemanticItemTypeText(item: ItemCardData): string {
	if (item.typeText !== undefined) {
		return item.typeText.trim();
	}
	const detailType = getDetailTypeText(item);
	if (detailType) {
		return detailType;
	}
	if (item.rawTags.some((tag) => tag.startsWith(WEAPON_TAG_PREFIX))) {
		return 'Weapon';
	}
	if (item.rawTags.some((tag) => tag.startsWith(ARMOR_TAG_PREFIX))) {
		return 'Armor';
	}
	const family = item.name.match(/\b(weapon|armor)\b/iu)?.[1];
	return family ? capitalizeFirst(family) : '';
}

export function formatItemRarity(value: string): string {
	return value
		.replaceAll('_', ' ')
		.replaceAll('-', ' ')
		.replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
}

export function isUnknownRarityText(value: string | undefined): boolean {
	return value?.trim().toLocaleLowerCase() === 'unknown';
}

function getDetailTypeText(item: ItemCardData): string {
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
	const rarity = item.rarity ? normalizeIdentityText(formatItemRarity(item.rarity)) : '';
	return rarity && normalizeIdentityText(primary).startsWith(rarity) ? '' : primary;
}

function normalizeIdentityText(value: string): string {
	return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function capitalizeFirst(value: string): string {
	return value.length > 0
		? `${value[0]?.toLocaleUpperCase()}${value.slice(1)}`
		: value;
}
