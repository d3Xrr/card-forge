import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import { planItemCardPages } from '../src/renderer/item-card-planner';
import {
	buildCompactItemStatLines,
	buildItemStatRows,
	formatItemWeight,
	hasMeaningfulItemStats,
} from '../src/renderer/structured-item-stats';

function createItem(overrides: Partial<ItemCardData> = {}): ItemCardData {
	return {
		filePath: '2. Mechanics/items/test.md',
		name: 'Test Weapon',
		description: '',
		hasImage: true,
		rawTags: [],
		...overrides,
	};
}

void test('builds a useful full Greataxe stat presentation without prose', () => {
	const item = createItem({
		name: 'Greataxe',
		damage: '1d12 slashing',
		properties: ['Heavy', 'Two-Handed'],
		mastery: 'Cleave',
		cost: '30 gp',
		weight: 7,
	});

	assert.equal(hasMeaningfulItemStats(item), true);
	assert.deepEqual(buildItemStatRows(item), [
		{ label: 'Damage', values: ['1d12 slashing'] },
		{ label: 'Properties', values: ['Heavy · Two-Handed'] },
		{ label: 'Mastery', values: ['Cleave'] },
		{ label: 'Weight', values: ['7 lb.'] },
		{ label: 'Cost', values: ['30 gp'] },
	]);
	const pages = planItemCardPages(item, { artworkOrientation: 'landscape' });
	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.showStats, true);
	assert.equal(pages[0]?.statsPresentation, 'full');
	assert.deepEqual(pages[0]?.blocks, []);
});

void test('labels Battleaxe one-handed and two-handed damage', () => {
	const rows = buildItemStatRows(createItem({
		name: 'Battleaxe',
		damage: '1d8 slashing',
		damageTwoHanded: '1d10 slashing',
		properties: ['Versatile'],
		mastery: 'Topple',
		cost: '10 gp',
		weight: 4,
	}));
	assert.deepEqual(rows[0], {
		label: 'Damage',
		values: ['One-handed: 1d8 slashing', 'Two-handed: 1d10 slashing'],
	});
	assert.equal(formatItemWeight(4), '4 lb.');
});

void test('includes range in centralized structured statistics', () => {
	const rows = buildItemStatRows(createItem({
		damage: '1d8 slashing',
		range: '20/60',
		properties: ['Thrown', 'Versatile'],
	}));
	assert.deepEqual(rows.find((row) => row.label === 'Range'), {
		label: 'Range',
		values: ['20/60'],
	});
});

void test('preserves magic weapon properties in compact stats', () => {
	const lines = buildCompactItemStatLines(createItem({
		name: 'Scimitar of Speed',
		description: 'A magic weapon effect.',
		damage: '1d6 slashing',
		properties: ['Finesse', 'Light'],
		mastery: 'Nick',
	}));
	assert.equal(lines[0], '1d6 slashing · Finesse · Light · Mastery: Nick');
});

void test('shows structured stats only on the primary page', () => {
	const item = createItem({
		description: Array.from(
			{ length: 30 },
			(_, index) => `Rule ${index + 1} explains a distinct artifact property.`,
		).join('\n\n'),
		damage: '1d8 slashing',
		damageTwoHanded: '1d10 slashing',
		range: '20/60',
		properties: ['Thrown', 'Versatile'],
		mastery: 'Topple',
		weight: 4,
	});
	const pages = planItemCardPages(item, { artworkOrientation: 'landscape' });

	assert.ok(pages.length > 1);
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.showStats, true);
	assert.ok(pages.slice(1).every((page) => !page.showStats && !page.showArtwork));
});
