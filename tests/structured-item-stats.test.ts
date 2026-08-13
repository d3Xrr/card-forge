import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import { planItemCardPages } from '../src/renderer/item-card-planner';
import {
	buildItemStatRows,
	estimateItemStatsLoad,
	formatItemWeight,
	hasMeaningfulItemStats,
	isCompactAtomicStatValue,
	selectCompactStatsLayout,
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
	const item = createItem({
		name: 'Battleaxe',
		damage: '1d8 slashing',
		damageTwoHanded: '1d10 slashing',
		properties: ['Versatile'],
		mastery: 'Topple',
		cost: '10 gp',
		weight: 4,
	});
	const rows = buildItemStatRows(item);
	assert.deepEqual(rows[0], {
		label: 'Damage',
		values: ['One-handed: 1d8 slashing', 'Two-handed: 1d10 slashing'],
	});
	assert.equal(formatItemWeight(4), '4 lb.');
	const pages = planItemCardPages(item, { artworkOrientation: 'landscape' });
	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.statsPresentation, 'full');
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

void test('promotes Scimitar metadata to labeled structured rows', () => {
	const item = createItem({
		name: 'Scimitar of Speed',
		description: 'You gain a +2 bonus to attack and damage rolls.\n\nYou can make one attack as a Bonus Action.',
		damage: '1d6 slashing',
		properties: ['Finesse', 'Light'],
		mastery: 'Nick',
		weight: 3,
	});
	assert.deepEqual(buildItemStatRows(item), [
		{ label: 'Damage', values: ['1d6 slashing'] },
		{ label: 'Properties', values: ['Finesse · Light'] },
		{ label: 'Mastery', values: ['Nick'] },
		{ label: 'Weight', values: ['3 lb.'] },
	]);
	assert.ok(estimateItemStatsLoad(item, 'compact') > 0);
	const pages = planItemCardPages(item, { artworkOrientation: 'landscape' });
	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.statsPresentation, 'compact');
	assert.equal(pages[0]?.layout, 'image');
});

void test('keeps compact damage and short metadata groups atomic when practical', () => {
	assert.equal(isCompactAtomicStatValue('Damage', '1d4 piercing'), true);
	assert.equal(isCompactAtomicStatValue('Damage', '2d8 force'), true);
	assert.equal(isCompactAtomicStatValue('Properties', 'Finesse Â· Light'), true);
	assert.equal(isCompactAtomicStatValue('Mastery', 'Nick'), true);
	assert.equal(
		isCompactAtomicStatValue('Damage', 'One-handed: 1d8 slashing'),
		false,
	);
	assert.equal(
		isCompactAtomicStatValue('Properties', 'A very long collection of properties that needs wrapping'),
		false,
	);
});

void test('stacks Axe-like compact stats beside portrait artwork', () => {
	const item = createItem({
		name: 'Artifact Axe',
		description: Array.from(
			{ length: 18 },
			(_, index) => `Artifact property ${index + 1} describes a distinct effect.`,
		).join('\n\n'),
		damage: '1d8 slashing',
		damageTwoHanded: '1d10 slashing',
		properties: ['Thrown', 'Versatile'],
		mastery: 'Topple',
		range: '20/60',
		weight: 4,
	});
	const pages = planItemCardPages(item, { artworkOrientation: 'portrait' });

	assert.equal(pages[0]?.layout, 'portrait');
	assert.equal(pages[0]?.showArtwork, true);
	assert.equal(pages[0]?.statsPresentation, 'compact');
	assert.equal(selectCompactStatsLayout('compact', pages[0].layout), 'stacked');
	assert.deepEqual(buildItemStatRows(item).map((row) => row.label), [
		'Damage',
		'Properties',
		'Mastery',
		'Range',
		'Weight',
	]);
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
