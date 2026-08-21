import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import type { ItemCardPage } from '../src/models/item-card-page';
import type { PrintQueueEntry } from '../src/models/print-queue';
import { createEffectiveCardInput } from '../src/services/effective-card';
import { paginatePhysicalCards } from '../src/export/a4-sheet-geometry';
import { createRasterCacheKey } from '../src/export/card-raster-identity';
import {
	calculatePrintQueueSummary,
	flattenPrintQueue,
	getInvalidQueueEntries,
	resolvePrintQueue,
	type PhysicalItemPlan,
} from '../src/services/print-queue-planner';

const EMPTY_SET = new Set<number>();

void test('marks a missing item unavailable instead of crashing', () => {
	const entries: PrintQueueEntry[] = [{ id: 'missing', filePath: 'missing.md', quantity: 1 }];
	const [resolved] = resolvePrintQueue(entries, [], new Map());
	assert.equal(resolved?.unavailable, true);
	assert.deepEqual(resolved?.pages, []);
});

void test('flattens queue order, copy order, then continuation page order', () => {
	const scimitar = createItem('scimitar.md', 'Scimitar');
	const rod = createItem('rod.md', 'Rod');
	const entries: PrintQueueEntry[] = [
		{ id: 'scimitar', filePath: scimitar.filePath, quantity: 2 },
		{ id: 'rod', filePath: rod.filePath, quantity: 3 },
	];
	const plans = new Map<string, PhysicalItemPlan>([
		['scimitar', { pages: [createPage(scimitar, 0, 1)], unfitPageIndexes: EMPTY_SET }],
		['rod', { pages: [createPage(rod, 0, 2), createPage(rod, 1, 2)], unfitPageIndexes: EMPTY_SET }],
	]);
	const flattened = flattenPrintQueue(resolvePrintQueue(entries, [scimitar, rod], plans));
	assert.deepEqual(flattened.map((card) => `${card.itemName}:${card.copyIndex + 1}:${card.pageIndex + 1}`), [
		'Scimitar:1:1',
		'Scimitar:2:1',
		'Rod:1:1',
		'Rod:1:2',
		'Rod:2:1',
		'Rod:2:2',
		'Rod:3:1',
		'Rod:3:2',
	]);
});

void test('calculates unique types, copies, physical cards, A4 pages, and missing entries', () => {
	const item = createItem('rod.md', 'Rod');
	const entries: PrintQueueEntry[] = [
		{ id: 'rod', filePath: item.filePath, quantity: 5 },
		{ id: 'missing', filePath: 'missing.md', quantity: 2 },
	];
	const plan: PhysicalItemPlan = {
		pages: [createPage(item, 0, 2), createPage(item, 1, 2)],
		unfitPageIndexes: EMPTY_SET,
	};
	const summary = calculatePrintQueueSummary(resolvePrintQueue(
		entries,
		[item],
		new Map([['rod', plan]]),
	));
	assert.deepEqual(summary, {
		itemTypes: 2,
		copies: 7,
		physicalCards: 10,
		a4Pages: 2,
		unavailableEntries: 1,
	});
});

void test('preview-approved canonical pages are the same pages consumed by export', () => {
	const item = createItem('apparatus.md', 'Apparatus');
	const pages = [
		createPage(item, 0, 3),
		createPage(item, 1, 3),
		createPage(item, 2, 3),
	];
	const resolved = resolvePrintQueue(
		[{ id: 'apparatus', filePath: item.filePath, quantity: 1 }],
		[item],
		new Map([['apparatus', {
			pages,
			unfitPageIndexes: EMPTY_SET,
			cacheKey: 'effective-apparatus-v1',
			artworkResourcePath: 'app://art/apparatus.webp',
			artworkRevisionFingerprint: 'apparatus-art-v1',
		}]]),
	);

	assert.deepEqual(getInvalidQueueEntries(resolved), []);
	assert.deepEqual(
		flattenPrintQueue(resolved).map((card) => card.page),
		pages,
	);
	assert.equal(resolved[0]?.cacheKey, 'effective-apparatus-v1');
	assert.ok(flattenPrintQueue(resolved).every((card) =>
		card.artworkResourcePath === 'app://art/apparatus.webp'
		&& card.artworkRevisionFingerprint === 'apparatus-art-v1',
	));
});

void test('resolves distinct overridden entries from one source by queue entry id', () => {
	const source = createItem('sword.md', 'Sword');
	const fire = { ...source, name: 'Fire Sword' };
	const frost = { ...source, name: 'Frost Sword' };
	const entries: PrintQueueEntry[] = [
		{ id: 'fire', filePath: source.filePath, quantity: 1, overrides: { title: fire.name } },
		{ id: 'frost', filePath: source.filePath, quantity: 1, overrides: { title: frost.name } },
	];
	const resolved = resolvePrintQueue(entries, [source], new Map([
		['fire', { item: fire, pages: [createPage(fire, 0, 1)], unfitPageIndexes: EMPTY_SET }],
		['frost', { item: frost, pages: [createPage(frost, 0, 1)], unfitPageIndexes: EMPTY_SET }],
	]));
	assert.deepEqual(flattenPrintQueue(resolved).map((card) => card.itemName), [
		'Fire Sword',
		'Frost Sword',
	]);
});

void test('an applied edited plan immediately changes queue and A4 counts', () => {
	const source = createItem('long.md', 'Long Item');
	const entry: PrintQueueEntry = {
		id: 'edited',
		filePath: source.filePath,
		quantity: 2,
		overrides: { rulesMarkdown: 'Shortened rules.' },
	};
	const pages = [createPage(source, 0, 2), createPage(source, 1, 2)];
	const summary = calculatePrintQueueSummary(resolvePrintQueue(
		[entry],
		[source],
		new Map([[entry.id, { item: source, pages, unfitPageIndexes: EMPTY_SET }]]),
	));
	assert.equal(summary.physicalCards, 4);
	assert.equal(summary.a4Pages, 1);
});

void test('same-source entries retain entry-specific pages through quantity and A4 materialization', () => {
	const source = createItem('synthetic-source.md', 'Synthetic Quarterstaff');
	const firstItem = { ...source, description: 'Rules AAA' };
	const secondItem = { ...source, description: 'Rules BBB' };
	const entries: PrintQueueEntry[] = [
		{ id: 'quarterstaff-a', filePath: source.filePath, quantity: 2, overrides: { rulesMarkdown: 'Rules AAA' } },
		{ id: 'quarterstaff-b', filePath: source.filePath, quantity: 1, overrides: { rulesMarkdown: 'Rules BBB' } },
	];
	const firstPages = [
		createMarkedPage(firstItem, 0, 2, 'AAA-1'),
		createMarkedPage(firstItem, 1, 2, 'AAA-2'),
	];
	const secondPages = [
		createMarkedPage(secondItem, 0, 2, 'BBB-1'),
		createMarkedPage(secondItem, 1, 2, 'BBB-2'),
	];
	const resolved = resolvePrintQueue(entries, [source], new Map([
		['quarterstaff-a', {
			item: firstItem,
			pages: firstPages,
			unfitPageIndexes: EMPTY_SET,
			cacheKey: 'exact-plan-a',
			artworkResourcePath: 'app://art/a.webp',
			artworkRevisionFingerprint: 'art-a-v1',
		}],
		['quarterstaff-b', {
			item: secondItem,
			pages: secondPages,
			unfitPageIndexes: EMPTY_SET,
			cacheKey: 'exact-plan-b',
			artworkResourcePath: 'app://art/b.webp',
			artworkRevisionFingerprint: 'art-b-v1',
		}],
	]));
	const flattened = flattenPrintQueue(resolved);
	const expected = ['AAA-1', 'AAA-2', 'AAA-1', 'AAA-2', 'BBB-1', 'BBB-2'];

	assert.deepEqual(flattened.map(getPageMarker), expected);
	assert.deepEqual(flattened.map((card) => card.queueEntryId), [
		'quarterstaff-a',
		'quarterstaff-a',
		'quarterstaff-a',
		'quarterstaff-a',
		'quarterstaff-b',
		'quarterstaff-b',
	]);
	assert.deepEqual(flattened.map((card) => card.physicalPlanKey), [
		'exact-plan-a',
		'exact-plan-a',
		'exact-plan-a',
		'exact-plan-a',
		'exact-plan-b',
		'exact-plan-b',
	]);
	assert.deepEqual(paginatePhysicalCards(flattened)[0]?.map(getPageMarker), expected);
	assert.strictEqual(flattened[0]?.page, firstPages[0]);
	assert.strictEqual(flattened[4]?.page, secondPages[0]);
	const rasterKeys = flattened.map((card) => createRasterCacheKey({
		page: card.page,
		...(card.physicalPlanKey
			? { physicalPlanKey: card.physicalPlanKey }
			: {}),
		...(card.artworkResourcePath
			? { artworkResourcePath: card.artworkResourcePath }
			: {}),
		...(card.artworkRevisionFingerprint
			? { artworkRevisionFingerprint: card.artworkRevisionFingerprint }
			: {}),
	}));
	assert.equal(rasterKeys[0], rasterKeys[2], 'identical A1 copies reuse raster identity');
	assert.notEqual(rasterKeys[0], rasterKeys[4], 'entry B keeps distinct raster identity');
});

void test('same-source Dagger, Quarterstaff, and Warhammer plans stay isolated by entry id', () => {
	const source = createItem('plus-one-weapon.md', 'Synthetic +1 Weapon');
	const names = ['Synthetic Dagger', 'Synthetic Quarterstaff', 'Synthetic Warhammer'];
	const entries = names.map((name, index) => ({
		id: `variant-${index}`,
		filePath: source.filePath,
		quantity: 1,
		overrides: { variant: { id: name } },
	}));
	const plans = new Map<string, PhysicalItemPlan>(entries.map((entry, index) => {
		const item = { ...source, name: names[index]! };
		return [entry.id, {
			item,
			pages: [createPage(item, 0, 1)],
			unfitPageIndexes: EMPTY_SET,
			cacheKey: `variant-plan-${index}`,
		}];
	}));
	const flattened = flattenPrintQueue(resolvePrintQueue(entries, [source], plans));
	assert.deepEqual(flattened.map((card) => card.itemName), names);
	assert.deepEqual(flattened.map((card) => card.physicalPlanKey), [
		'variant-plan-0',
		'variant-plan-1',
		'variant-plan-2',
	]);
});

void test('different-source edited cards retain five distinct A4 page identities after reload', () => {
	const swordSource = {
		...createItem('sword-source.md', 'Longsword'),
		description: 'Sword rules',
		weight: 3,
	};
	const armorSource = {
		...createItem('armor-source.md', 'Armor of Invulnerability'),
		description: 'Armor rules',
		weight: 65,
	};
	const wandSource = {
		...createItem('wand-source.md', 'Wand of the Precocious Apprentice'),
		description: 'Wand rules',
	};
	const items = [swordSource, armorSource, wandSource];
	const entries: PrintQueueEntry[] = [
		{
			id: 'sword-id',
			filePath: swordSource.filePath,
			quantity: 1,
			overrides: {
				title: 'Sword of Khaine',
				stats: { cost: '15000 gp' },
				sourceText: 'Homebrew',
				artwork: { kind: 'temporary', id: 'missing-sword-art', origin: 'local' },
			},
		},
		{ id: 'armor-id', filePath: armorSource.filePath, quantity: 1 },
		{ id: 'wand-id', filePath: wandSource.filePath, quantity: 1 },
	];
	const pageCounts = new Map([
		['sword-id', 1],
		['armor-id', 2],
		['wand-id', 2],
	]);
	const plans = new Map<string, PhysicalItemPlan>(entries.map((entry) => {
		const source = items.find((item) => item.filePath === entry.filePath);
		assert.ok(source);
		const item = createEffectiveCardInput(source, items, entry.overrides).item;
		const pageCount = pageCounts.get(entry.id) ?? 1;
		return [entry.id, {
			item,
			pages: Array.from(
				{ length: pageCount },
				(_unused, index) => createPage(item, index, pageCount),
			),
			unfitPageIndexes: EMPTY_SET,
			cacheKey: `plan-${entry.id}`,
		}];
	}));
	const flattened = flattenPrintQueue(resolvePrintQueue(entries, items, plans));

	assert.deepEqual(flattened.map((card) => card.itemName), [
		'Sword of Khaine',
		'Armor of Invulnerability',
		'Armor of Invulnerability',
		'Wand of the Precocious Apprentice',
		'Wand of the Precocious Apprentice',
	]);
	assert.deepEqual(flattened.map((card) => card.queueEntryId), [
		'sword-id',
		'armor-id',
		'armor-id',
		'wand-id',
		'wand-id',
	]);
	assert.deepEqual(flattened.map((card) => card.page.item.description), [
		'Sword rules',
		'Armor rules',
		'Armor rules',
		'Wand rules',
		'Wand rules',
	]);
	assert.deepEqual(paginatePhysicalCards(flattened)[0], flattened);
});

function createItem(filePath: string, name: string): ItemCardData {
	return {
		filePath,
		name,
		description: '',
		hasImage: false,
		rawTags: [],
	};
}

function createPage(item: ItemCardData, pageIndex: number, pageCount: number): ItemCardPage {
	return {
		item,
		pageIndex,
		pageCount,
		kind: pageIndex === 0 ? 'primary' : 'continuation',
		title: item.name,
		blocks: [],
		layout: 'text',
		showArtwork: false,
		showStats: false,
		showSource: pageIndex === pageCount - 1,
		hasUnsplitOverflow: false,
	};
}

function createMarkedPage(
	item: ItemCardData,
	pageIndex: number,
	pageCount: number,
	marker: string,
): ItemCardPage {
	return {
		...createPage(item, pageIndex, pageCount),
		blocks: [{ type: 'paragraph', markdown: marker }],
	};
}

function getPageMarker(card: { page: ItemCardPage }): string {
	const block = card.page.blocks[0];
	return block?.type === 'paragraph' ? block.markdown : '';
}
