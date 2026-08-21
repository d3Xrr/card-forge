import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	applyItemBrowserInteraction,
	clearBatchSelection,
	createItemBrowserFilterOptions,
	DEFAULT_ITEM_BROWSER_FILTERS,
	filterIndexedItems,
	formatBrowserResultCount,
	getItemBrowserTypeText,
	isItemBrowserFiltered,
	normalizeBrowserFilterValue,
	removeBatchSelections,
	resolveBatchSelection,
	selectAllFilteredItems,
} from '../src/services/item-browser-workflow';

const items = [
	createItem('armor.md', 'Armor of Resolve', {
		detail: 'Armor (plate), rare (requires attunement)',
		rarity: 'Rare',
		source: 'dmg-2024',
		attunement: true,
	}),
	createItem('amulet.md', 'Amulet of Focus', {
		detail: 'Wondrous Item, RARE',
		rarity: 'rare',
		source: 'DMG-2024',
		attunement: false,
	}),
	createItem('wand.md', 'Wand of Practice', {
		detail: 'Wand, uncommon',
		rarity: 'uncommon',
		source: 'xge',
		attunement: true,
	}),
	createItem('sword.md', 'Practice Sword', {
		detail: 'Weapon (longsword), common',
		rarity: 'common',
		source: 'phb-2024',
		attunement: false,
	}),
];

void test('search and each structured filter operate on indexed metadata', () => {
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		query: 'armor',
	}).map((item) => item.filePath), ['armor.md']);
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		type: 'weapon',
	}).map((item) => item.filePath), ['sword.md']);
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		rarity: 'rare',
	}).map((item) => item.filePath), ['armor.md', 'amulet.md']);
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		source: 'dmg-2024',
	}).map((item) => item.filePath), ['armor.md', 'amulet.md']);
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		attunement: 'required',
	}).map((item) => item.filePath), ['armor.md', 'wand.md']);
	assert.deepEqual(filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		attunement: 'none',
	}).map((item) => item.filePath), ['amulet.md', 'sword.md']);
});

void test('search and filters combine with logical AND and support no matches', () => {
	const combined = filterIndexedItems(items, {
		query: 'armor',
		type: 'armor',
		rarity: 'rare',
		source: 'dmg-2024',
		attunement: 'required',
	});
	assert.deepEqual(combined.map((item) => item.filePath), ['armor.md']);
	assert.deepEqual(filterIndexedItems(items, {
		query: 'wand',
		type: 'armor',
		rarity: '',
		source: '',
		attunement: 'all',
	}), []);
});

void test('filter options collapse equivalent casing and retain useful type/source distinctions', () => {
	const options = createItemBrowserFilterOptions(items);
	assert.deepEqual(options.rarities.filter((option) => option.value === 'rare'), [
		{ value: 'rare', label: 'Rare' },
	]);
	assert.deepEqual(options.types.map((option) => option.value), [
		'armor',
		'wand',
		'weapon',
		'wondrous item',
	]);
	assert.equal(options.sources.filter((option) => option.value === 'dmg-2024').length, 1);
	assert.equal(normalizeBrowserFilterValue('  RARE  '), 'rare');
	assert.equal(getItemBrowserTypeText(items[0]!), 'Armor (plate)');
});

void test('result counts distinguish filtered and unfiltered states and filters clear cleanly', () => {
	assert.equal(formatBrowserResultCount(4, 4, false), '4 items');
	assert.equal(formatBrowserResultCount(1, 4, true), '1 of 4 items');
	assert.equal(isItemBrowserFiltered(DEFAULT_ITEM_BROWSER_FILTERS), false);
	assert.equal(isItemBrowserFiltered({ ...DEFAULT_ITEM_BROWSER_FILTERS, rarity: 'rare' }), true);
	assert.deepEqual(filterIndexedItems(items, DEFAULT_ITEM_BROWSER_FILTERS), items);
});

void test('batch checkbox interactions never replace the active preview selection', () => {
	const original = {
		previewFilePath: 'armor.md',
		selectedFilePaths: new Set<string>(),
	};
	const checked = applyItemBrowserInteraction(original, {
		kind: 'batch',
		filePath: 'wand.md',
		selected: true,
	});
	assert.equal(checked.previewFilePath, 'armor.md');
	assert.deepEqual([...checked.selectedFilePaths], ['wand.md']);
	const unchecked = applyItemBrowserInteraction(checked, {
		kind: 'batch',
		filePath: 'wand.md',
		selected: false,
	});
	assert.equal(unchecked.previewFilePath, 'armor.md');
	assert.equal(unchecked.selectedFilePaths.size, 0);
	const previewed = applyItemBrowserInteraction(checked, {
		kind: 'preview',
		filePath: 'sword.md',
	});
	assert.equal(previewed.previewFilePath, 'sword.md');
	assert.deepEqual([...previewed.selectedFilePaths], ['wand.md']);
});

void test('select all filtered retains hidden selections and clear removes all selections', () => {
	const rareItems = filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		rarity: 'rare',
	});
	const selected = selectAllFilteredItems(new Set(['wand.md']), rareItems);
	assert.deepEqual([...selected].sort(), ['amulet.md', 'armor.md', 'wand.md']);
	const hiddenByCommonFilter = filterIndexedItems(items, {
		...DEFAULT_ITEM_BROWSER_FILTERS,
		rarity: 'common',
	});
	assert.deepEqual(hiddenByCommonFilter.map((item) => item.filePath), ['sword.md']);
	assert.deepEqual([...selected].sort(), ['amulet.md', 'armor.md', 'wand.md']);
	assert.equal(clearBatchSelection().size, 0);
});

void test('batch resolution follows index order, reports missing paths, and clears only successes', () => {
	const selected = new Set(['wand.md', 'missing.md', 'armor.md']);
	const resolved = resolveBatchSelection(items, selected);
	assert.deepEqual(resolved.items.map((item) => item.filePath), ['armor.md', 'wand.md']);
	assert.deepEqual(resolved.missingFilePaths, ['missing.md']);
	assert.deepEqual(
		[...removeBatchSelections(selected, resolved.items.map((item) => item.filePath))],
		['missing.md'],
	);
});

void test('browser controls are semantic, compact, responsive, and isolated from card planning', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	const css = readFileSync('styles.css', 'utf8');
	const workflow = readFileSync('src/services/item-browser-workflow.ts', 'utf8');
	assert.match(view, /type: 'checkbox'/u);
	assert.match(view, /aria-label': `Select \$\{item\.name\} for batch queue addition`/u);
	assert.match(view, /text: 'Add selected'/u);
	assert.match(view, /text: 'Select all filtered'/u);
	assert.match(view, /this\.printQueue\.addMany/u);
	assert.match(view, /cls: 'dropdown ttrpg-card-forge__filter-select'/u);
	assert.match(css, /ttrpg-card-forge__batch-actions[^}]*flex-wrap:\s*wrap/isu);
	assert.match(css, /ttrpg-card-forge__filters[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/isu);
	assert.match(css, /max-width:\s*420px[\s\S]*ttrpg-card-forge__filters[^}]*minmax\(0,\s*1fr\)/iu);
	assert.doesNotMatch(workflow, /ItemCardFitService|beginPhysicalPlan|paginatePhysical|PdfExport|ArtworkBounds/iu);
});

void test('filter dropdown styling uses scoped Obsidian theme variables', () => {
	const css = readFileSync('styles.css', 'utf8');
	const selectRule = getCssRule(css, '.ttrpg-card-forge__filter-select');
	const optionRule = getCssRule(css, '.ttrpg-card-forge__filter-select option');
	assert.match(selectRule, /color:\s*var\(--text-normal\)/u);
	assert.match(selectRule, /background-color:\s*var\(--background-modifier-form-field\)/u);
	assert.match(optionRule, /color:\s*var\(--text-normal\)/u);
	assert.match(optionRule, /background-color:\s*var\(--background-primary\)/u);
	assert.match(css, /\.theme-dark \.ttrpg-card-forge__filter-select[^}]*color-scheme:\s*dark/su);
	assert.match(css, /\.theme-light \.ttrpg-card-forge__filter-select[^}]*color-scheme:\s*light/su);
	assert.doesNotMatch(css, /(^|\})\s*(select|option)\s*\{/mu);
});

function createItem(
	filePath: string,
	name: string,
	fields: Partial<ItemCardData>,
): ItemCardData {
	return {
		filePath,
		name,
		description: '',
		hasImage: false,
		rawTags: [],
		...fields,
	};
}

function getCssRule(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))?.[1] ?? '';
}
