import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isCliItem,
	normalizeVaultPath,
	parseItemFrontmatter,
	parseLinkedList,
} from '../src/parsers/item-parser';
import {
	normalizeObsidianCallouts,
	parseItemDescription,
	stripMarkdownLinks,
} from '../src/parsers/item-description-parser';
import { isSupportedArtworkPath } from '../src/services/artwork-resolver';

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
	itemDetail: 'Weapon ([scimitar](scimitar.md)), very rare (requires attunement)',
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
		description: '',
		detail: 'Weapon (scimitar), very rare (requires attunement)',
		imagePath: '2. Mechanics/items/img/scimitar-of-speed.webp',
		hasImage: false,
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
		normalizeVaultPath('\\2.%20Mechanics\\items\\img\\item.webp#right'),
		'2. Mechanics/items/img/item.webp',
	);
	assert.deepEqual(parseLinkedList(['[Finesse](a.md)', 'Light']), ['Finesse', 'Light']);
	assert.equal(isSupportedArtworkPath('/items/img/item.JPEG#right'), true);
	assert.equal(isSupportedArtworkPath('/items/img/item.svg'), false);
});

void test('normalizes complete mundane weapon statistics', () => {
	const greataxe = parseItemFrontmatter('greataxe.md', {
		cssclasses: ['json5e-item'],
		itemDmg: '1d12 slashing',
		itemProp: 'Heavy, Two-Handed',
		itemCost: '30 gp',
		itemWeight: 7,
		itemMastery: 'Cleave',
	});
	assert.deepEqual(greataxe?.properties, ['Heavy', 'Two-Handed']);
	assert.equal(greataxe?.damage, '1d12 slashing');
	assert.equal(greataxe?.mastery, 'Cleave');
	assert.equal(greataxe?.cost, '30 gp');
	assert.equal(greataxe?.weight, 7);
});

void test('normalizes two-handed damage and range', () => {
	const battleaxe = parseItemFrontmatter('battleaxe.md', {
		cssclasses: ['json5e-item'],
		itemDmg: '1d8 slashing',
		itemDmg2h: '1d10 slashing',
		itemRange: '20/60',
		itemProp: ['Versatile', 'Thrown'],
		itemCost: '10 gp',
		itemWeight: 4,
		itemMastery: '[Topple](topple.md)',
	});
	assert.equal(battleaxe?.damageTwoHanded, '1d10 slashing');
	assert.equal(battleaxe?.range, '20/60');
	assert.deepEqual(battleaxe?.properties, ['Versatile', 'Thrown']);
	assert.equal(battleaxe?.mastery, 'Topple');
});

void test('removes nested one-handed and two-handed CLI summary lines', () => {
	const markdown = `# Battleaxe
*Weapon, martial weapon*

- **Damage**:
  - One-handed: 1d8 slashing
  - Two-handed: 1d10 slashing
- **Properties**: Versatile
- **Mastery**: Topple
- **Cost**: 10 gp
- **Weight**: 4 lb.`;
	assert.equal(parseItemDescription(markdown, 'Weapon, martial weapon').description, '');
});

void test('strips CLI boilerplate and retains only item rules prose', () => {
	const markdown = `---
name: Scimitar of Speed
---
# Scimitar of Speed
*Weapon ([scimitar](scimitar.md)), very rare (requires attunement)*

![](/2.%20Mechanics/items/img/scimitar-of-speed.webp#right)

- **Damage**: 1d6 slashing
- **Properties**: [Finesse](finesse.md), [Light](light.md)
- **Mastery**: [Nick](nick.md)
- **Weight**: 3.0 lb.

You gain a +2 bonus to **attack rolls** and damage rolls made with this magic weapon.

In addition, you can make one attack with it as a [Bonus Action](/2.%20Mechanics/rules/bonus-action.md) on each of your turns.

*Source: Dungeon Master's Guide (2024) p. 302*`;

	assert.deepEqual(
		parseItemDescription(
			markdown,
			'Weapon ([scimitar](scimitar.md)), very rare (requires attunement)',
		),
		{
			description: 'You gain a +2 bonus to **attack rolls** and damage rolls made with this magic weapon.\n\nIn addition, you can make one attack with it as a Bonus Action on each of your turns.',
			sourceText: "Dungeon Master's Guide (2024) p. 302",
		},
	);
});

void test('preserves legitimate rules bullet and numbered lists', () => {
	const markdown = `# Clockwork Charm
*Wondrous item, uncommon*

Choose one benefit:

- Gain **advantage** on the check.
- Add \`1d4\` to the result.

Then resolve these steps:

1. Roll the die.
2. Apply the result.`;

	assert.equal(
		parseItemDescription(markdown, 'Wondrous item, uncommon').description,
		'Choose one benefit:\n\n- Gain **advantage** on the check.\n- Add `1d4` to the result.\n\nThen resolve these steps:\n\n1. Roll the die.\n2. Apply the result.',
	);
});

void test('preserves section headings and literal bracketed crafting components', () => {
	const markdown = `# Wand of the Precocious Apprentice
*Wand, uncommon*

The wand holds a flicker of borrowed magic.

## Crafting

Creating the wand requires:

- **[Animus].** Any
- **[Bones].** Bones from an Undead
- **[Dust].** Fey Dust
- **[Fluid].** Ectoplasm`;

	assert.equal(
		parseItemDescription(markdown, 'Wand, uncommon').description,
		'The wand holds a flicker of borrowed magic.\n\n## Crafting\n\nCreating the wand requires:\n\n- **[Animus].** Any\n- **[Bones].** Bones from an Undead\n- **[Dust].** Fey Dust\n- **[Fluid].** Ectoplasm',
	);
});

void test('converts Markdown and wiki links to visible text without exposing destinations', () => {
	assert.equal(
		stripMarkdownLinks(
			'Use [Bonus Action](/2.%20Mechanics/rules/action-(bonus).md) with [[rules/reaction.md|Reaction]].',
		),
		'Use Bonus Action with Reaction.',
	);
});

void test('normalizes simple, titled, and multiline Obsidian callouts for card rules', () => {
	assert.equal(
		normalizeObsidianCallouts('> [!note]\n> Readable note text.'),
		'Readable note text.',
	);
	assert.equal(
		normalizeObsidianCallouts('> [!warning] Special Rule\n> Something happens.'),
		'**Special Rule.**\nSomething happens.',
	);
	assert.equal(
		normalizeObsidianCallouts('> [!note]\n> line one\n> line two'),
		'line one\nline two',
	);
});

void test('normalizes the real Multiweapon inline callout shape without changing source input', () => {
	const markdown = [
		'# Multiweapon',
		'*Weapon*',
		'',
		'A rule chooses its damage type > [!note]',
		'> (bludgeoning, piercing, or slashing) can be changed as a bonus action.',
	].join('\n');
	const before = markdown;
	const parsed = parseItemDescription(markdown, 'Weapon').description;
	assert.equal(markdown, before);
	assert.doesNotMatch(parsed, /\[!note\]|^\s*>/gmu);
	assert.match(parsed, /A rule chooses its damage type/u);
	assert.match(parsed, /bludgeoning, piercing, or slashing/u);
});
