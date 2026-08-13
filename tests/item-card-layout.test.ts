import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	estimateDescriptionLoad,
	selectItemCardLayout,
} from '../src/renderer/item-card-layout';

function createItem(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: '2. Mechanics/items/test-item.md',
		name: 'Test Item',
		description: 'A short rules paragraph.',
		hasImage: true,
		rawTags: [],
		...overrides,
	};
}

void test('selects image layout for artwork with a short description', () => {
	assert.equal(selectItemCardLayout(createItem()), 'image');
});

void test('selects compact layout for a medium structured description', () => {
	const description = Array.from(
		{ length: 7 },
		(_, index) => `Paragraph ${index + 1} explains a distinct magical rule with enough words to wrap.`,
	).join('\n\n');
	assert.equal(selectItemCardLayout(createItem({ description })), 'compact');
});

void test('selects text layout for missing artwork or heavy rules text', () => {
	assert.equal(selectItemCardLayout(createItem({ hasImage: false })), 'text');

	const longDescription = Array.from(
		{ length: 18 },
		(_, index) => `Rule ${index + 1}. This paragraph contains extensive instructions and conditional effects.`,
	).join('\n\n');
	assert.equal(selectItemCardLayout(createItem({ description: longDescription })), 'text');
});

void test('layout load accounts for paragraphs and lists as well as text length', () => {
	const flat = 'One concise sentence with a modest amount of text.';
	const structured = '- First option\n- Second option\n- Third option';
	assert.ok(estimateDescriptionLoad(structured) > estimateDescriptionLoad(flat));
});
