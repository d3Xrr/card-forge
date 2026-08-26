import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearCardDesignFieldVisibility,
	createCardDesignFingerprint,
	createCardDesignProfile,
	createBackVisualDesignFingerprint,
	createFrontVisualDesignFingerprint,
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
		...createCardDesignProfile(),
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

void test('Auto is a bounded explicit density while legacy cards remain Standard', () => {
	assert.equal(normalizeCardDesignProfile({ density: 'auto' }).density, 'auto');
	assert.equal(LEGACY_CARD_DESIGN_PROFILE.density, 'standard');
	assert.equal(createCardDesignProfile().density, 'standard');
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

void test('0.8 framing and back state normalize, persist, and reject unsafe image paths', () => {
	const design = normalizeCardDesignProfile({
		frontArtworkFraming: { fitMode: 'fill', zoom: 1.75, panX: 25, panY: -30 },
		back: {
			style: 'custom-image',
			customArtworkPath: 'Card Forge Assets/custom-back.png',
			artworkFraming: { fitMode: 'fill', zoom: 2, panX: -12, panY: 44 },
		},
	});
	assert.equal(design.frontArtworkFraming.fitMode, 'fill');
	assert.equal(design.back.customArtworkPath, 'Card Forge Assets/custom-back.png');
	assert.deepEqual(normalizeCardDesignProfile(JSON.parse(JSON.stringify(design))), design);
	assert.equal(normalizeCardDesignProfile({
		back: { style: 'custom-image', customArtworkPath: 'C:\\private\\back.png' },
	}).back.customArtworkPath, undefined);
	assert.equal(normalizeCardDesignProfile({
		back: { style: 'custom-image', customArtworkPath: '../back.png' },
	}).back.customArtworkPath, undefined);
});

void test('framing is raster-only and front/back pixel identities remain independent', () => {
	const baseline = createCardDesignProfile();
	const frontFramed = normalizeCardDesignProfile({
		...baseline,
		frontArtworkFraming: { fitMode: 'fill', zoom: 1.4, panX: 20, panY: 0 },
	});
	const backed = normalizeCardDesignProfile({
		...baseline,
		back: { style: 'rarity' },
	});
	assert.equal(
		createLayoutDesignFingerprint(baseline),
		createLayoutDesignFingerprint(frontFramed),
	);
	assert.notEqual(
		createFrontVisualDesignFingerprint(baseline),
		createFrontVisualDesignFingerprint(frontFramed),
	);
	assert.equal(
		createFrontVisualDesignFingerprint(baseline),
		createFrontVisualDesignFingerprint(backed),
	);
	assert.notEqual(
		createBackVisualDesignFingerprint(baseline),
		createBackVisualDesignFingerprint(backed),
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
