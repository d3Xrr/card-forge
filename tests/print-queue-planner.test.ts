import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import type { ItemCardPage } from '../src/models/item-card-page';
import type { PrintQueueEntry } from '../src/models/print-queue';
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
		[scimitar.filePath, { pages: [createPage(scimitar, 0, 1)], unfitPageIndexes: EMPTY_SET }],
		[rod.filePath, { pages: [createPage(rod, 0, 2), createPage(rod, 1, 2)], unfitPageIndexes: EMPTY_SET }],
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
		new Map([[item.filePath, plan]]),
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
		new Map([[item.filePath, {
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
