import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	flattenPageContent,
	planItemCardPages,
} from '../src/renderer/item-card-planner';
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

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, ' ').trim();
}
