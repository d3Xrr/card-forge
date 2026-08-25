import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearCardDesignFieldVisibility,
	createCardDesignFingerprint,
	createCardDesignProfile,
	createLayoutDesignFingerprint,
	createVisualDesignFingerprint,
	isCardDesignFieldVisible,
	LEGACY_CARD_DESIGN_PROFILE,
	normalizeCardDesignProfile,
	setCardDesignFieldVisibility,
} from '../src/models/card-design';
import type { ItemCardData } from '../src/models/item';

function createWeapon(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: 'items/quarterstaff.md',
		name: '+1 Quarterstaff',
		description: 'Weapon rules.',
		hasImage: false,
		rawTags: [],
		damage: '1d6 + 1 bludgeoning',
		damageTwoHanded: '1d8 + 1 bludgeoning',
		properties: ['versatile'],
		mastery: 'Topple',
		weight: 4,
		cost: '2 sp',
		source: 'XPHB',
		structuredFieldOrigins: { cost: 'base' },
		...overrides,
	};
}

void test('normalizes the bounded profile and rejects arbitrary presentation data', () => {
	assert.deepEqual(normalizeCardDesignProfile({
		theme: 'light',
		artworkSize: 'larger',
		density: 'compact',
		fieldVisibility: { weight: false, cost: true, title: false },
		css: 'display:none',
	}), {
		theme: 'light',
		artworkSize: 'larger',
		density: 'compact',
		fieldVisibility: { weight: false, cost: true },
	});
	assert.deepEqual(normalizeCardDesignProfile({
		theme: 'parchment', artworkSize: 100, density: 'tiny',
	}), LEGACY_CARD_DESIGN_PROFILE);
});

void test('legacy and configured defaults reproduce the 0.6.1 design', () => {
	assert.deepEqual(createCardDesignProfile(), LEGACY_CARD_DESIGN_PROFILE);
	assert.equal(
		createCardDesignFingerprint(undefined),
		createCardDesignFingerprint(LEGACY_CARD_DESIGN_PROFILE),
	);
});

void test('layout and visual fingerprints separate geometry from theme pixels', () => {
	const dark = normalizeCardDesignProfile({
		theme: 'dark', artworkSize: 'larger', density: 'compact',
	});
	const light = normalizeCardDesignProfile({ ...dark, theme: 'light' });
	assert.equal(createLayoutDesignFingerprint(dark), createLayoutDesignFingerprint(light));
	assert.notEqual(createVisualDesignFingerprint(dark), createVisualDesignFingerprint(light));
	assert.notEqual(
		createLayoutDesignFingerprint(dark),
		createLayoutDesignFingerprint({ ...dark, artworkSize: 'minimal' }),
	);
});

void test('field visibility preserves semantic auto behavior and provenance', () => {
	const item = createWeapon();
	assert.equal(isCardDesignFieldVisible(item, 'damage'), true);
	assert.equal(isCardDesignFieldVisible(item, 'cost'), false);
	assert.equal(isCardDesignFieldVisible(item, 'source'), true);

	let design = setCardDesignFieldVisibility(LEGACY_CARD_DESIGN_PROFILE, 'cost', true);
	assert.equal(isCardDesignFieldVisible(item, 'cost', design), true);
	design = setCardDesignFieldVisibility(design, 'weight', false);
	assert.equal(isCardDesignFieldVisible(item, 'weight', design), false);
	design = clearCardDesignFieldVisibility(design);
	assert.equal(isCardDesignFieldVisible(item, 'cost', design), false);
	assert.equal(isCardDesignFieldVisible(item, 'weight', design), true);
});

void test('explicit Cost remains automatic-visible and can still be forced hidden', () => {
	const item = createWeapon({
		cost: '15000 gp',
		structuredFieldOrigins: { cost: 'override' },
	});
	assert.equal(isCardDesignFieldVisible(item, 'cost'), true);
	const hidden = setCardDesignFieldVisibility(LEGACY_CARD_DESIGN_PROFILE, 'cost', false);
	assert.equal(isCardDesignFieldVisible(item, 'cost', hidden), false);
	assert.equal(isCardDesignFieldVisible(item, 'cost', clearCardDesignFieldVisibility(hidden)), true);
});

void test('Source visibility remains enabled even when no footer content exists', () => {
	const item = createWeapon({ source: undefined, sourceText: undefined });
	const design = setCardDesignFieldVisibility(LEGACY_CARD_DESIGN_PROFILE, 'source', true);
	assert.equal(isCardDesignFieldVisible(item, 'source', design), true);
});
