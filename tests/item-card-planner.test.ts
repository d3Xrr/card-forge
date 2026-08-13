import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	balanceSparseFinalPage,
	estimateBlocksLoad,
	flattenPageContent,
	planItemCardPages,
} from '../src/renderer/item-card-planner';
import { getRenderablePageBlocks } from '../src/renderer/item-card-renderer';
import {
	parseSemanticMarkdown,
	partitionCraftingSection,
	serializeSemanticMarkdown,
} from '../src/renderer/semantic-markdown';

function createItem(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: '2. Mechanics/items/test-item.md',
		name: 'Test Item',
		description: 'A short rules paragraph.',
		hasImage: true,
		rawTags: [],
		source: 'xdmg',
		sourceText: "Dungeon Master's Guide (2024) p. 302",
		...overrides,
	};
}

void test('extracts semantic paragraphs, headings, and lists', () => {
	const blocks = parseSemanticMarkdown([
		'An opening **rule**.',
		'',
		'## Crafting',
		'',
		'- **[Animus].** Any',
		'- **[Bones].** Undead bones',
		'',
		'1. First step',
		'2. Second step',
	].join('\n'));

	assert.deepEqual(blocks, [
		{ type: 'paragraph', markdown: 'An opening **rule**.' },
		{ type: 'heading', level: 2, markdown: 'Crafting' },
		{
			type: 'unordered-list',
			items: ['**[Animus].** Any', '**[Bones].** Undead bones'],
		},
		{ type: 'ordered-list', items: ['First step', 'Second step'] },
	]);
});

void test('recognizes Markdown tables and removes standalone Obsidian block IDs', () => {
	const blocks = parseSemanticMarkdown([
		'| Liquid | Max. Amount |',
		'| --- | --- |',
		'| Acid | 8 ounces |',
		'| Water \\| salt | 12 gallons |',
		'^alchemy-jug-liquids',
	].join('\n'));

	assert.deepEqual(blocks, [{
		type: 'table',
		headers: ['Liquid', 'Max. Amount'],
		rows: [
			['Acid', '8 ounces'],
			['Water | salt', '12 gallons'],
		],
	}]);
	assert.ok(blocks.every((block) => block.type !== 'paragraph'));
});

void test('preserves caret characters in prose while removing only standalone block IDs', () => {
	const blocks = parseSemanticMarkdown('The formula uses x^2 in prose.\n\n^print-anchor');
	assert.deepEqual(blocks, [{ type: 'paragraph', markdown: 'The formula uses x^2 in prose.' }]);
});

void test('detects Crafting as a structural heading section', () => {
	const sections = partitionCraftingSection(parseSemanticMarkdown([
		'Item effect.',
		'',
		'## Crafting',
		'',
		'Creating this item requires a workshop.',
		'',
		'- **[Fluid].** Ectoplasm',
	].join('\n')));

	assert.deepEqual(sections.main, [
		{ type: 'paragraph', markdown: 'Item effect.' },
	]);
	assert.deepEqual(sections.crafting, [
		{ type: 'heading', level: 2, markdown: 'Crafting' },
		{ type: 'paragraph', markdown: 'Creating this item requires a workshop.' },
		{ type: 'unordered-list', items: ['**[Fluid].** Ectoplasm'] },
	]);
});

void test('plans one source-bearing page for a short item', () => {
	const pages = planItemCardPages(createItem(), { artworkOrientation: 'landscape' });

	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.kind, 'primary');
	assert.equal(pages[0]?.layout, 'image');
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.showSource, true);
});

void test('plans multiple continuation pages for long rules text', () => {
	const description = Array.from(
		{ length: 36 },
		(_, index) => `Rule ${index + 1} applies while the item is active and explains a distinct effect.`,
	).join('\n\n');
	const pages = planItemCardPages(createItem({ description }), {
		artworkOrientation: 'landscape',
	});

	assert.ok(pages.length > 1);
	assert.equal(pages[0]?.kind, 'primary');
	assert.ok(pages.slice(1).every((page) => page.kind === 'continuation'));
});

void test('moves Crafting to a dedicated page as a unit when primary capacity is exceeded', () => {
	const craftingItems = Array.from(
		{ length: 8 },
		(_, index) => `- **[Component ${index + 1}].** A preserved ingredient`,
	).join('\n');
	const description = [
		'You gain a useful magical effect while holding this wand.',
		'',
		'## Crafting',
		'',
		'Creating this wand requires an Uncommon Workshop and these components:',
		'',
		craftingItems,
	].join('\n');
	const pages = planItemCardPages(createItem({ description }), {
		artworkOrientation: 'portrait',
	});

	assert.equal(pages.length, 2);
	assert.equal(pages[0]?.kind, 'primary');
	assert.equal(pages[0]?.layout, 'portrait');
	assert.equal(pages[1]?.kind, 'crafting');
	assert.equal(pages[1]?.blocks[0]?.type, 'heading');
	assert.equal(
		pages[1]?.blocks[0]?.type === 'heading'
			? pages[1].blocks[0].markdown
			: undefined,
		'Crafting',
	);
	assert.notEqual(getRenderablePageBlocks(pages[1]).at(0)?.type, 'heading');
});

void test('retains a Crafting heading when it remains on a normal primary page', () => {
	const pages = planItemCardPages(createItem({
		description: 'A short effect.\n\n## Crafting\n\nUse one crystal.',
	}), { artworkOrientation: 'landscape' });
	assert.equal(pages.length, 1);
	assert.ok(getRenderablePageBlocks(pages[0]!).some(
		(block) => block.type === 'heading' && block.markdown === 'Crafting',
	));
});

void test('splits oversized tables only between rows and repeats headers', () => {
	const rows = Array.from(
		{ length: 42 },
		(_, index) => `| Liquid ${index + 1} | ${index + 1} gallons |`,
	);
	const description = [
		'| Liquid | Max. Amount |',
		'| --- | --- |',
		...rows,
		'^alchemy-jug-liquids',
	].join('\n');
	const pages = planItemCardPages(createItem({
		description,
		hasImage: false,
	}), { capacityScale: 0.55 });
	const tables = pages.flatMap((page) =>
		page.blocks.filter((block) => block.type === 'table'),
	);

	assert.ok(tables.length > 1);
	assert.ok(tables.every((table) =>
		table.type === 'table'
		&& table.headers.join('|') === 'Liquid|Max. Amount'),
	);
	const renderedRows = tables.flatMap((table) => table.type === 'table' ? table.rows : []);
	assert.equal(renderedRows.length, 42);
	assert.deepEqual(
		renderedRows.map((row) => row[0]),
		Array.from({ length: 42 }, (_, index) => `Liquid ${index + 1}`),
	);
});

void test('represents all input content exactly once across planned pages', () => {
	const description = Array.from(
		{ length: 28 },
		(_, index) => `Sentence ${index + 1} grants a different benefit. Another condition ends that benefit.`,
	).join('\n\n');
	const pages = planItemCardPages(createItem({ description }), {
		artworkOrientation: 'square',
	});
	const canonicalInput = serializeSemanticMarkdown(parseSemanticMarkdown(description));

	assert.equal(normalizeWhitespace(flattenPageContent(pages)), normalizeWhitespace(canonicalInput));
});

void test('assigns stable page indexes/counts and source only to the final page', () => {
	const description = Array.from(
		{ length: 30 },
		(_, index) => `Rule ${index + 1} has enough detail to occupy part of a physical card.`,
	).join('\n\n');
	const pages = planItemCardPages(createItem({ description }));

	assert.ok(pages.length > 1);
	for (const [index, page] of pages.entries()) {
		assert.equal(page.pageIndex, index);
		assert.equal(page.pageCount, pages.length);
		assert.equal(page.showSource, index === pages.length - 1);
	}
});

void test('keeps unsafe-to-split inline Markdown intact and flags the exceptional block', () => {
	const description = `*${Array.from(
		{ length: 45 },
		(_, index) => `Sentence ${index + 1} remains inside one emphasis span.`,
	).join(' ')}*`;
	const pages = planItemCardPages(createItem({ description, hasImage: false }));

	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.blocks.length, 1);
	assert.equal(pages[0]?.hasUnsplitOverflow, true);
	assert.equal(flattenPageContent(pages), description);
});

void test('balances a sparse final page by moving whole trailing blocks in order', () => {
	const first = { type: 'paragraph', markdown: 'A'.repeat(170) } as const;
	const second = { type: 'paragraph', markdown: 'B'.repeat(170) } as const;
	const finalBlock = { type: 'paragraph', markdown: 'Final.' } as const;
	const pages = [
		{ kind: 'primary' as const, blocks: [first, second], contentCapacity: 20 },
		{ kind: 'continuation' as const, blocks: [finalBlock], contentCapacity: 20 },
	];

	balanceSparseFinalPage(pages);
	assert.deepEqual(pages[0]?.blocks, [first]);
	assert.deepEqual(pages[1]?.blocks, [second, finalBlock]);
	assert.ok(estimateBlocksLoad(pages[1].blocks) <= pages[1].contentCapacity);
	assert.equal(
		pages.flatMap((page) => page.blocks).map((block) => block.markdown).join(''),
		`${first.markdown}${second.markdown}${finalBlock.markdown}`,
	);
});

void test('balancing never introduces overflow or changes an already reasonable split', () => {
	const large = { type: 'paragraph', markdown: 'L'.repeat(420) } as const;
	const sparse = { type: 'paragraph', markdown: 'End.' } as const;
	const overflowRisk = [
		{ kind: 'primary' as const, blocks: [sparse, large], contentCapacity: 20 },
		{ kind: 'continuation' as const, blocks: [sparse], contentCapacity: 10 },
	];
	balanceSparseFinalPage(overflowRisk);
	assert.equal(overflowRisk[0]?.blocks.length, 2);
	assert.equal(overflowRisk[1]?.blocks.length, 1);

	const alreadyBalanced = [
		{ kind: 'primary' as const, blocks: [sparse, large], contentCapacity: 20 },
		{
			kind: 'continuation' as const,
			blocks: [{ type: 'paragraph' as const, markdown: 'F'.repeat(330) }],
			contentCapacity: 20,
		},
	];
	const before = structuredClone(alreadyBalanced);
	balanceSparseFinalPage(alreadyBalanced);
	assert.deepEqual(alreadyBalanced, before);
});

void test('table fragments remain valid after final-page balancing', () => {
	const headers = ['Liquid', 'Amount'];
	const firstTable = { type: 'table' as const, headers, rows: [['Acid', '8 oz']] };
	const finalTable = { type: 'table' as const, headers, rows: [['Oil', '1 quart']] };
	const pages = [
		{
			kind: 'continuation' as const,
			blocks: [{ type: 'paragraph' as const, markdown: 'Intro.' }, firstTable],
			contentCapacity: 20,
		},
		{ kind: 'continuation' as const, blocks: [finalTable], contentCapacity: 20 },
	];
	balanceSparseFinalPage(pages);
	const tables = pages.flatMap((page) =>
		page.blocks.filter((block) => block.type === 'table'),
	);
	assert.ok(tables.every((table) =>
		table.type === 'table' && table.headers.join('|') === headers.join('|')),
	);
	assert.deepEqual(
		tables.flatMap((table) => table.type === 'table' ? table.rows : []),
		[['Acid', '8 oz'], ['Oil', '1 quart']],
	);
});

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, ' ').trim();
}
