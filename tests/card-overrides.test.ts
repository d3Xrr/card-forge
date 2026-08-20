import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	applyCardOverrides,
	areCardOverridesEqual,
	createCardOverridesFingerprint,
	splitManualCardBreaks,
} from '../src/services/card-overrides';

const source: ItemCardData = {
	filePath: 'items/example.md',
	name: 'Example',
	description: 'Source rules',
	detail: 'Weapon',
	imagePath: 'art/source.png',
	hasImage: true,
	damage: '1d6',
	properties: ['Light'],
	rawTags: [],
};

void test('no override preserves the exact indexed item object', () => {
	assert.strictEqual(applyCardOverrides(source, undefined).item, source);
});

void test('applies print overrides without mutating the indexed source', () => {
	const result = applyCardOverrides(source, {
		title: 'Edited Example',
		rulesMarkdown: 'First\n\n///CARD BREAK///\n\nSecond',
		stats: { damage: '2d6', properties: null },
		artwork: { kind: 'none' },
	});
	assert.equal(source.name, 'Example');
	assert.equal(source.description, 'Source rules');
	assert.equal(result.item.name, 'Edited Example');
	assert.deepEqual(result.item.manualRuleSegments, ['First', 'Second']);
	assert.equal(result.item.description, 'First\n\nSecond');
	assert.equal(result.item.damage, '2d6');
	assert.equal(result.item.properties, undefined);
	assert.equal(result.item.hasImage, false);
});

void test('title, rules, source, and vault artwork overrides resolve independently', () => {
	const result = applyCardOverrides(source, {
		title: 'Print title',
		rulesMarkdown: 'Print-only rules.',
		sourceText: 'Home table reference',
		artwork: { kind: 'vault', path: 'Card Forge Assets/custom.webp' },
	});
	assert.equal(result.item.name, 'Print title');
	assert.equal(result.item.description, 'Print-only rules.');
	assert.equal(result.item.sourceDisplayOverride, 'Home table reference');
	assert.equal(result.item.imagePath, 'Card Forge Assets/custom.webp');
	assert.equal(result.item.hasImage, true);
});

void test('explicit source display overrides do not replace canonical source metadata', () => {
	const dmgSource = {
		...source,
		source: 'xdmg',
		sourceText: "Dungeon Master's Guide (2024), p. 230",
	};
	const edited = applyCardOverrides(dmgSource, { sourceText: 'Test' }).item;
	assert.equal(edited.source, 'xdmg');
	assert.equal(edited.sourceText, "Dungeon Master's Guide (2024), p. 230");
	assert.equal(edited.sourceDisplayOverride, 'Test');
	const blank = applyCardOverrides(dmgSource, { sourceText: null }).item;
	assert.equal(blank.sourceDisplayOverride, '');
	assert.equal(applyCardOverrides(dmgSource, undefined).item.sourceDisplayOverride, undefined);
});

void test('manual card break delimiter is removed from rendered rules', () => {
	assert.deepEqual(splitManualCardBreaks('A\n///CARD BREAK///\nB'), ['A', 'B']);
	assert.deepEqual(splitManualCardBreaks('A ///CARD BREAK/// B'), ['A ///CARD BREAK/// B']);
});

void test('override fingerprint is deterministic and distinguishes planning state', () => {
	const left = { title: ' Sword ', stats: { properties: [' Light ', 'Finesse'] } };
	const right = { stats: { properties: ['Light', 'Finesse'] }, title: 'Sword' };
	assert.equal(createCardOverridesFingerprint(left), createCardOverridesFingerprint(right));
	assert.equal(areCardOverridesEqual(left, right), true);
	assert.notEqual(
		createCardOverridesFingerprint(left),
		createCardOverridesFingerprint({ ...right, title: 'Axe' }),
	);
	assert.notEqual(
		createCardOverridesFingerprint({ typeText: null }),
		createCardOverridesFingerprint({ rarityText: null }),
	);
	assert.notEqual(
		createCardOverridesFingerprint({ rulesMarkdown: 'A\n///CARD BREAK///\nB' }),
		createCardOverridesFingerprint({ rulesMarkdown: 'A B\n///CARD BREAK///' }),
	);
});

void test('invalid persisted override fields are discarded safely', () => {
	const result = applyCardOverrides(source, {
		title: 42,
		artwork: { kind: 'vault', path: '' },
		stats: { weight: Number.NaN },
	});
	assert.equal(result.overrides, undefined);
	assert.deepEqual(result.item, { ...source, description: 'Source rules' });
});

void test('editing one identity field retains inherited rarity and attunement', () => {
	const item = {
		...source,
		detail: 'Weapon (blade), rare (requires attunement)',
		rarity: 'rare',
		attunement: true,
	};
	const effective = applyCardOverrides(item, { typeText: 'Custom weapon' }).item;
	assert.equal(effective.typeText, 'Custom weapon');
	assert.equal(effective.rarityText, 'Rare');
	assert.equal(effective.attunementText, 'Requires attunement');
});
