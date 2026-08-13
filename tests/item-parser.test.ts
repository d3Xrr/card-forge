import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isCliItem,
	normalizeVaultPath,
	parseItemFrontmatter,
	parseLinkedList,
} from '../src/parsers/item-parser';

const exampleFrontmatter = {
	cssclasses: ['json5e-item'],
	tags: [
		'ttrpg-cli/compendium/src/5e/xdmg',
		'ttrpg-cli/item/attunement/required',
		'ttrpg-cli/item/rarity/very-rare',
	],
	name: 'Scimitar of Speed',
	itemDmg: '1d6 slashing',
	itemProp: '[Finesse](finesse.md), [Light](light.md)',
	itemWeight: 3,
	itemMastery: '[Nick](nick.md)',
	itemDetail: 'Weapon (scimitar), very rare (requires attunement)',
	image: '/2.%20Mechanics/items/img/scimitar-of-speed.webp',
};

void test('identifies only json5e item frontmatter', () => {
	assert.equal(isCliItem(exampleFrontmatter), true);
	assert.equal(isCliItem({ cssclasses: ['other-class'] }), false);
	assert.equal(isCliItem(undefined), false);
});

void test('normalizes the requested item fields and derived tags', () => {
	const item = parseItemFrontmatter(
		'2. Mechanics/items/scimitar-of-speed.md',
		exampleFrontmatter,
	);

	assert.deepEqual(item, {
		filePath: '2. Mechanics/items/scimitar-of-speed.md',
		name: 'Scimitar of Speed',
		detail: 'Weapon (scimitar), very rare (requires attunement)',
		imagePath: '2. Mechanics/items/img/scimitar-of-speed.webp',
		rarity: 'very-rare',
		attunement: true,
		source: 'xdmg',
		damage: '1d6 slashing',
		properties: ['Finesse', 'Light'],
		mastery: 'Nick',
		weight: 3,
		rawTags: exampleFrontmatter.tags,
	});
});

void test('returns null for Markdown that is not an item', () => {
	assert.equal(
		parseItemFrontmatter('2. Mechanics/items/readme.md', { name: 'Read me' }),
		null,
	);
});

void test('falls back to the filename and tolerates incomplete metadata', () => {
	const item = parseItemFrontmatter('2. Mechanics/items/nameless-item.md', {
		cssclasses: 'json5e-item',
		itemWeight: '2.5',
	});

	assert.equal(item?.name, 'nameless-item');
	assert.equal(item?.weight, 2.5);
	assert.equal(item?.attunement, false);
});

void test('normalizes encoded paths and linked property lists', () => {
	assert.equal(
		normalizeVaultPath('\\2.%20Mechanics\\items\\img\\item.webp'),
		'2. Mechanics/items/img/item.webp',
	);
	assert.deepEqual(parseLinkedList(['[Finesse](a.md)', 'Light']), ['Finesse', 'Light']);
});
