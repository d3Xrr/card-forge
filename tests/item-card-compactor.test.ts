import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ItemCardPage,
	MarkdownBlock,
} from '../src/models/item-card-page';
import { compactContinuationPages } from '../src/renderer/item-card-compactor';
import { serializeSemanticMarkdown } from '../src/renderer/semantic-markdown';

void test('compacts content forward across the full continuation sequence', async () => {
	const pages = [
		createPage('primary', [paragraph('primary')]),
		createPage('continuation', [paragraph('a')]),
		createPage('continuation', [paragraph('b')]),
		createPage('continuation', [paragraph('c')]),
		createPage('continuation', [paragraph('d')]),
		createPage('continuation', [paragraph('e')]),
	];
	const compacted = await compactContinuationPages(
		pages,
		(page) => page.blocks.length <= 2,
	);

	assert.deepEqual(
		compacted.map((page) => page.blocks.map(blockText)),
		[['primary'], ['a', 'b'], ['c', 'd'], ['e']],
	);
	assert.equal(compacted.length, 4);
	assert.deepEqual(
		compacted.map((page) => [page.pageIndex, page.pageCount, page.showSource]),
		[[0, 4, false], [1, 4, false], [2, 4, false], [3, 4, true]],
	);
});

void test('removes an empty trailing continuation page', async () => {
	const pages = [
		createPage('primary', [paragraph('primary')]),
		createPage('continuation', [paragraph('a')]),
		createPage('continuation', []),
	];
	const compacted = await compactContinuationPages(pages, () => true);

	assert.equal(compacted.length, 2);
	assert.equal(compacted.at(-1)?.showSource, true);
	assert.equal(compacted.at(-1)?.pageCount, 2);
});

void test('preserves original block order and represents every block exactly once', async () => {
	const pages = [
		createPage('primary', [paragraph('zero')]),
		createPage('continuation', [paragraph('one')]),
		createPage('continuation', [paragraph('two'), paragraph('three')]),
		createPage('continuation', [paragraph('four')]),
	];
	const before = serializePages(pages);
	const compacted = await compactContinuationPages(
		pages,
		(page) => page.blocks.length <= 3,
	);

	assert.equal(serializePages(compacted), before);
	assert.deepEqual(
		compacted.flatMap((page) => page.blocks.map(blockText)),
		['zero', 'one', 'two', 'three', 'four'],
	);
});

void test('stops filling a dense page when measured fit fails', async () => {
	const pages = [
		createPage('primary', [paragraph('primary')]),
		createPage('continuation', [paragraph('dense')]),
		createPage('continuation', [paragraph('next')]),
	];
	let fitChecks = 0;
	const compacted = await compactContinuationPages(pages, () => {
		fitChecks += 1;
		return false;
	});

	assert.equal(fitChecks, 1);
	assert.deepEqual(
		compacted.map((page) => page.blocks.map(blockText)),
		[['primary'], ['dense'], ['next']],
	);
});

void test('keeps heading and first following block together when testing a move', async () => {
	const pages = [
		createPage('primary', [paragraph('primary')]),
		createPage('continuation', [paragraph('existing')]),
		createPage('continuation', [
			{ type: 'heading', level: 2, markdown: 'Travel the Depths' },
			paragraph('opening content'),
			paragraph('tail'),
		]),
	];
	const candidateSizes: number[] = [];
	const compacted = await compactContinuationPages(pages, (page) => {
		candidateSizes.push(page.blocks.length);
		return page.blocks.length <= 3;
	});

	assert.equal(candidateSizes[0], 3);
	assert.deepEqual(compacted[1]?.blocks.map(blockText), [
		'existing',
		'Travel the Depths',
		'opening content',
	]);
	assert.deepEqual(compacted[2]?.blocks.map(blockText), ['tail']);
});

void test('does not cross a dedicated Crafting boundary', async () => {
	const pages = [
		createPage('primary', [paragraph('effect')]),
		createPage('continuation', [paragraph('rules')]),
		createPage('crafting', [
			{ type: 'heading', level: 2, markdown: 'Crafting' },
			paragraph('components'),
		]),
	];
	let fitChecks = 0;
	const compacted = await compactContinuationPages(pages, () => {
		fitChecks += 1;
		return true;
	});

	assert.equal(fitChecks, 0);
	assert.deepEqual(compacted[1]?.blocks.map(blockText), ['rules']);
	assert.deepEqual(compacted[2]?.blocks.map(blockText), ['Crafting', 'components']);
});

void test('preserves table fragment headers, row order, and row uniqueness', async () => {
	const firstTable = table([['Acid', '8 ounces']]);
	const secondTable = table([['Oil', '1 quart'], ['Water', '8 gallons']]);
	const pages = [
		createPage('primary', [paragraph('effect')]),
		createPage('continuation', [firstTable]),
		createPage('continuation', [secondTable]),
	];
	const compacted = await compactContinuationPages(
		pages,
		(page) => page.blocks.length <= 2,
	);
	const tables = compacted.flatMap((page) =>
		page.blocks.filter((block) => block.type === 'table'),
	);

	assert.equal(tables.length, 2);
	assert.ok(tables.every((block) =>
		block.type === 'table' && block.headers.join('|') === 'Liquid|Amount'),
	);
	assert.deepEqual(
		tables.flatMap((block) => block.type === 'table' ? block.rows : []),
		[['Acid', '8 ounces'], ['Oil', '1 quart'], ['Water', '8 gallons']],
	);
});

function createPage(
	kind: ItemCardPage['kind'],
	blocks: MarkdownBlock[],
): ItemCardPage {
	return {
		item: {
			filePath: 'item.md',
			name: 'Test Item',
			description: '',
			hasImage: false,
			rawTags: [],
		},
		pageIndex: 0,
		pageCount: 1,
		kind,
		title: 'Test Item',
		blocks,
		layout: 'text',
		showArtwork: false,
		showStats: false,
		showSource: false,
		hasUnsplitOverflow: false,
	};
}

function paragraph(markdown: string): MarkdownBlock {
	return { type: 'paragraph', markdown };
}

function table(rows: string[][]): MarkdownBlock {
	return { type: 'table', headers: ['Liquid', 'Amount'], rows };
}

function blockText(block: MarkdownBlock): string {
	return block.type === 'heading' || block.type === 'paragraph'
		? block.markdown
		: block.type;
}

function serializePages(pages: readonly ItemCardPage[]): string {
	return serializeSemanticMarkdown(pages.flatMap((page) => page.blocks));
}
