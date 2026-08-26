import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCardDesignProfile } from '../src/models/card-design';
import type { ItemCardPage } from '../src/models/item-card-page';
import {
	createCardBackPresentation,
	resolveItemTypeCategory,
} from '../src/renderer/card-back-renderer';

const page: ItemCardPage = {
	item: {
		filePath: 'items/flame-tongue.md',
		name: 'Flame Tongue',
		description: 'Rules.',
		detail: 'Weapon (Longsword), rare',
		rarity: 'rare',
		typeText: 'Weapon (Longsword)',
		hasImage: true,
		rawTags: [],
	},
	pageIndex: 0,
	pageCount: 2,
	kind: 'primary',
	title: 'Flame Tongue',
	blocks: [],
	layout: 'image',
	showArtwork: true,
	showStats: false,
	showSource: false,
	hasUnsplitOverflow: false,
};

void test('bounded non-art back styles resolve stable semantic presentation', () => {
	assert.deepEqual(present('none'), {
		printed: false,
		usesArtwork: false,
		title: 'No back',
		subtitle: 'This position remains blank when backs are exported',
	});
	assert.equal(present('generic').title, 'Card Forge');
	assert.equal(present('rarity').title, 'Rare');
	assert.equal(present('item-type').title, 'Weapon (Longsword)');
	assert.equal(resolveItemTypeCategory(page), 'weapon');
});

void test('artwork and custom-image styles expose deterministic missing-image fallbacks', () => {
	assert.equal(present('artwork', false).subtitle, 'This item has no resolved artwork');
	assert.equal(present('custom-image', false).subtitle, 'Choose a valid vault image');
	assert.equal(present('artwork', true).usesArtwork, true);
	assert.equal(present('custom-image', true).title, 'Card Forge');
});

void test('continuation pages retain the logical card back rather than page-specific state', () => {
	const continuation = { ...page, pageIndex: 1, kind: 'continuation' as const };
	const design = normalizeCardDesignProfile({ back: { style: 'rarity' } });
	assert.deepEqual(
		createCardBackPresentation(page, design, false),
		createCardBackPresentation(continuation, design, false),
	);
});

function present(
	style: 'none' | 'generic' | 'rarity' | 'item-type' | 'artwork' | 'custom-image',
	hasArtwork = false,
) {
	return createCardBackPresentation(
		page,
		normalizeCardDesignProfile({ back: { style } }),
		hasArtwork,
	);
}
