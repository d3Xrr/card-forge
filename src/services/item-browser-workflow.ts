import type { ItemCardData } from '../models/item';
import { getSemanticItemTypeText } from './item-identity';
import { formatSourceDisplay } from '../renderer/source-formatter';

export type AttunementFilter = 'all' | 'required' | 'none';

export interface ItemBrowserFilters {
	query: string;
	type: string;
	rarity: string;
	source: string;
	attunement: AttunementFilter;
}

export interface ItemBrowserFilterOption {
	value: string;
	label: string;
}

export interface ItemBrowserFilterOptions {
	types: readonly ItemBrowserFilterOption[];
	rarities: readonly ItemBrowserFilterOption[];
	sources: readonly ItemBrowserFilterOption[];
}

export interface ItemBrowserSelectionState {
	previewFilePath: string | null;
	selectedFilePaths: ReadonlySet<string>;
}

export type ItemBrowserInteraction =
	| { kind: 'preview'; filePath: string }
	| { kind: 'batch'; filePath: string; selected: boolean };

export interface ResolvedBatchSelection {
	items: ItemCardData[];
	missingFilePaths: string[];
}

export const DEFAULT_ITEM_BROWSER_FILTERS: Readonly<ItemBrowserFilters> = {
	query: '',
	type: '',
	rarity: '',
	source: '',
	attunement: 'all',
};

export function filterIndexedItems(
	items: readonly ItemCardData[],
	filters: Readonly<ItemBrowserFilters>,
): ItemCardData[] {
	const query = normalizeBrowserFilterValue(filters.query);
	return items.filter((item) =>
		(!query || isSearchMatch(item, query))
		&& (!filters.type || getItemFilterTypeValue(item) === filters.type)
		&& (!filters.rarity || normalizeBrowserFilterValue(item.rarity) === filters.rarity)
		&& (!filters.source || normalizeBrowserFilterValue(item.source) === filters.source)
		&& (
			filters.attunement === 'all'
			|| (filters.attunement === 'required' ? item.attunement === true : item.attunement !== true)
		),
	);
}

export function createItemBrowserFilterOptions(
	items: readonly ItemCardData[],
): ItemBrowserFilterOptions {
	return {
		types: createOptions(items, getItemFilterTypeText, getItemFilterTypeText),
		rarities: createOptions(
			items,
			(item) => item.rarity,
			(item) => humanizeSlug(item.rarity ?? ''),
		),
		sources: createOptions(
			items,
			(item) => item.source,
			(item) => formatSourceDisplay(item.source, item.sourceText, 'compact'),
		),
	};
}

export function isItemBrowserFiltered(filters: Readonly<ItemBrowserFilters>): boolean {
	return Boolean(
		filters.query.trim()
		|| filters.type
		|| filters.rarity
		|| filters.source
		|| filters.attunement !== 'all',
	);
}

export function formatBrowserResultCount(
	visibleCount: number,
	totalCount: number,
	filtered: boolean,
): string {
	return filtered
		? `${visibleCount} of ${totalCount} items`
		: formatItemCount(totalCount);
}

export function applyItemBrowserInteraction(
	state: Readonly<ItemBrowserSelectionState>,
	interaction: ItemBrowserInteraction,
): ItemBrowserSelectionState {
	if (interaction.kind === 'preview') {
		return {
			previewFilePath: interaction.filePath,
			selectedFilePaths: state.selectedFilePaths,
		};
	}

	const selectedFilePaths = new Set(state.selectedFilePaths);
	if (interaction.selected) {
		selectedFilePaths.add(interaction.filePath);
	} else {
		selectedFilePaths.delete(interaction.filePath);
	}
	return {
		previewFilePath: state.previewFilePath,
		selectedFilePaths,
	};
}

export function selectAllFilteredItems(
	selectedFilePaths: ReadonlySet<string>,
	filteredItems: readonly ItemCardData[],
): Set<string> {
	const selected = new Set(selectedFilePaths);
	for (const item of filteredItems) {
		selected.add(item.filePath);
	}
	return selected;
}

export function resolveBatchSelection(
	items: readonly ItemCardData[],
	selectedFilePaths: ReadonlySet<string>,
): ResolvedBatchSelection {
	const remaining = new Set(selectedFilePaths);
	const resolved: ItemCardData[] = [];
	for (const item of items) {
		if (!remaining.delete(item.filePath)) {
			continue;
		}
		resolved.push(item);
	}
	return {
		items: resolved,
		missingFilePaths: [...remaining].sort((left, right) => left.localeCompare(right)),
	};
}

export function removeBatchSelections(
	selectedFilePaths: ReadonlySet<string>,
	completedFilePaths: Iterable<string>,
): Set<string> {
	const remaining = new Set(selectedFilePaths);
	for (const filePath of completedFilePaths) {
		remaining.delete(filePath);
	}
	return remaining;
}

export function clearBatchSelection(): Set<string> {
	return new Set<string>();
}

export function getItemBrowserTypeText(item: ItemCardData): string {
	return getSemanticItemTypeText(item);
}

export function normalizeBrowserFilterValue(value: string | undefined): string {
	return value
		?.normalize('NFKC')
		.trim()
		.replace(/\s+/gu, ' ')
		.toLocaleLowerCase() ?? '';
}

function getItemFilterTypeText(item: ItemCardData): string {
	return getItemBrowserTypeText(item).replace(/\s*\([^)]*\)\s*$/u, '').trim();
}

function getItemFilterTypeValue(item: ItemCardData): string {
	return normalizeBrowserFilterValue(getItemFilterTypeText(item));
}

function isSearchMatch(item: ItemCardData, query: string): boolean {
	return [
		item.name,
		item.rarity,
		item.source,
		item.sourceText,
		item.detail,
		getItemBrowserTypeText(item),
		...item.rawTags,
	]
		.filter((value): value is string => Boolean(value))
		.some((value) => normalizeBrowserFilterValue(value).includes(query));
}

function createOptions(
	items: readonly ItemCardData[],
	getValue: (item: ItemCardData) => string | undefined,
	getLabel: (item: ItemCardData) => string | undefined,
): ItemBrowserFilterOption[] {
	const options = new Map<string, string>();
	for (const item of items) {
		const value = normalizeBrowserFilterValue(getValue(item));
		const label = getLabel(item)?.trim();
		if (value && label && !options.has(value)) {
			options.set(value, label);
		}
	}
	return [...options]
		.map(([value, label]) => ({ value, label }))
		.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}

function formatItemCount(count: number): string {
	return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function humanizeSlug(value: string): string {
	return value
		.split('-')
		.map((part) => part ? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}` : part)
		.join(' ');
}
