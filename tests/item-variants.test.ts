import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	discoverItemVariants,
	getVariantDisplayLabel,
	inferVariantBaseName,
} from '../src/services/item-variants';
import { applyCardOverrides } from '../src/services/card-overrides';
import { buildItemStatRows } from '../src/renderer/structured-item-stats';
import { getStructuredItemFieldOrigin } from '../src/models/item';

function item(name: string, description = ''): ItemCardData {
	return { filePath: `items/${name}.md`, name, description, hasImage: false, rawTags: [] };
}

void test('discovers bonus-prefixed armor variants and merges base statistics', () => {
	const base = { ...item('Breastplate'), detail: 'Medium armor', cost: '400 gp', weight: 20 };
	const source = {
		...item('+1 Armor', [
			'While wearing this armor, you gain a magical benefit.',
			'',
			'**Variants**:',
			'- [[#^breastplate|+1 Breastplate]]',
			'',
			'### +1 Breastplate',
			'- **Armor Class**: 14 + Dex modifier (max 2)',
			'- **Weight**: 20 lb.',
		].join('\n')),
		rarity: 'rare',
	};
	const variants = discoverItemVariants(source, [source, base]);
	assert.equal(variants.length, 1);
	assert.equal(variants[0]?.baseName, 'Breastplate');
	assert.equal(variants[0]?.item.typeText, 'Medium armor');
	assert.equal(variants[0]?.item.cost, '400 gp');
	assert.equal(variants[0]?.item.weight, 20);
	assert.match(variants[0]?.item.description ?? '', /Armor Class/u);
	assert.doesNotMatch(variants[0]?.item.description ?? '', /\*\*Variants\*\*/u);
});

void test('discovers source-name-prefixed weapon variants with section stats', () => {
	const base = { ...item('Longsword'), detail: 'Weapon', mastery: 'Sap', cost: '15 gp' };
	const source = item('Flame Tongue', [
		'The weapon sheds bright light.',
		'',
		'**Variants**:',
		'- [[#longsword|Flame Tongue Longsword]]',
		'',
		'### Flame Tongue Longsword',
		'- **Damage**: 1d8 Slashing',
		'- **Two-Handed Damage**: 1d10 Slashing',
		'- **Properties**: [[Versatile]]',
	].join('\n'));
	const variant = discoverItemVariants(source, [source, base])[0];
	assert.equal(variant?.baseName, 'Longsword');
	assert.equal(variant?.item.damage, '1d8 Slashing');
	assert.equal(variant?.item.damageTwoHanded, '1d10 Slashing');
	assert.deepEqual(variant?.item.properties, ['Versatile']);
	assert.equal(variant?.item.mastery, 'Sap');
	assert.equal(variant?.item.cost, '15 gp');
	assert.doesNotMatch(variant?.item.description ?? '', /\*\*(?:Damage|Properties)\*\*/u);
	assert.ok(variant);
	assert.equal(
		applyCardOverrides(variant.item, { title: 'My Flame Blade' }).item.name,
		'My Flame Blade',
	);
});

void test('items without the marker and headings remain ordinary items', () => {
	assert.deepEqual(discoverItemVariants(item('Ordinary', 'Rules'), []), []);
	assert.equal(inferVariantBaseName('Flame Tongue', 'Unrelated Heading'), undefined);
});

void test('resolves a base item generically when a variant adds a trailing magic qualifier', () => {
	const base = { ...item('Breastplate'), weight: 20 };
	const magicNameDecoy = { ...item('Breastplate of Cold Resistance'), rarity: 'rare' };
	const source = item('+1 Armor of Cold Resistance', [
		'Magical resistance rule.',
		'**Variants**:',
		'### +1 Breastplate of Cold Resistance',
		'- **Weight**: 20 lb.',
	].join('\n'));
	const variant = discoverItemVariants(source, [source, magicNameDecoy, base])[0];
	assert.equal(variant?.baseItem, base);
	assert.equal(variant?.baseName, 'Breastplate');
	assert.equal(variant?.item.name, '+1 Breastplate of Cold Resistance');
});

void test('projects plain nested one- and two-handed damage without duplicate stat prose', () => {
	const bases = [
		{ ...item('Dagger'), damage: '1d4 piercing', properties: ['Finesse', 'Light', 'Thrown'], mastery: 'Nick', range: '20/60', weight: 1, cost: '2 gp' },
		{ ...item('Longsword'), properties: ['Versatile'], mastery: 'Sap', weight: 3, cost: '15 gp' },
		{ ...item('Warhammer'), properties: ['Versatile'], mastery: 'Push', weight: 5, cost: '15 gp' },
		{ ...item('Spear'), properties: ['Thrown', 'Versatile'], mastery: 'Sap', range: '20/60', weight: 3, cost: '1 gp' },
	];
	const source = item('Flame Tongue', [
		'Magic flame rules remain visible.',
		'',
		'**Variants**:',
		'### Flame Tongue Dagger',
		'- **Damage**: 1d4 piercing',
		'- **Properties**: Finesse, Light, Thrown',
		'### Flame Tongue Longsword',
		'- **Damage**:',
		'  - One-handed: 1d8 slashing',
		'  - Two-handed: 1d10 slashing',
		'- **Properties**: [Versatile](/rules/versatile)',
		'### Flame Tongue Warhammer',
		'- **Damage**:',
		'  - One-handed: 1d8 bludgeoning',
		'  - Two-handed: 1d10 bludgeoning',
		'- **Properties**: Versatile',
		'### Flame Tongue Spear',
		'- **Damage**:',
		'  - One handed: 1d6 piercing',
		'  - Two handed: 1d8 piercing',
	].join('\n'));
	const variants = discoverItemVariants(source, [source, ...bases]);
	const byLabel = new Map(variants.map((variant) => [variant.label, variant]));

	const expected = [
		['Flame Tongue Dagger', '1d4 piercing', undefined],
		['Flame Tongue Longsword', '1d8 slashing', '1d10 slashing'],
		['Flame Tongue Warhammer', '1d8 bludgeoning', '1d10 bludgeoning'],
		['Flame Tongue Spear', '1d6 piercing', '1d8 piercing'],
	] as const;
	for (const [label, damage, twoHanded] of expected) {
		const variant = byLabel.get(label);
		assert.equal(variant?.item.damage, damage);
		assert.equal(variant?.item.damageTwoHanded, twoHanded);
		assert.match(variant?.item.description ?? '', /Magic flame rules remain visible/u);
		assert.doesNotMatch(
			variant?.item.description ?? '',
			/One[- ]handed|Two[- ]handed|\*\*Damage\*\*/iu,
		);
		const damageRow = variant
			? buildItemStatRows(variant.item).find((row) => row.label === 'Damage')
			: undefined;
		assert.ok(damageRow);
		assert.equal(damageRow.values.some((value) => value.includes(damage)), true);
		if (twoHanded) {
			assert.equal(damageRow.values.some((value) => value.includes(twoHanded)), true);
		}
	}
	assert.deepEqual(byLabel.get('Flame Tongue Longsword')?.item.properties, ['Versatile']);
});

void test('uses resolved base names only for concise selector presentation', () => {
	const base = item('Warhammer');
	const source = item('Flame Tongue', [
		'Rules',
		'**Variants**:',
		'### Flame Tongue Warhammer',
		'Variant rules.',
		'### Unresolved Ceremonial Form',
		'Fallback rules.',
	].join('\n'));
	const [resolved, fallback] = discoverItemVariants(source, [source, base]);
	assert.ok(resolved);
	assert.ok(fallback);
	assert.equal(getVariantDisplayLabel(resolved), 'Warhammer');
	assert.equal(resolved.label, 'Flame Tongue Warhammer');
	assert.equal(resolved.item.name, 'Flame Tongue Warhammer');
	assert.equal(getVariantDisplayLabel(fallback), 'Unresolved Ceremonial Form');
});

void test('selector labels fall back to headings when a base name is only inferred', () => {
	const source = item('+1 Armor', [
		'Rules',
		'**Variants**:',
		'### +1 Mythril Weave',
		'Variant rules.',
	].join('\n'));
	const variant = discoverItemVariants(source, [source])[0];
	assert.ok(variant);
	assert.equal(variant.baseName, 'Mythril Weave');
	assert.equal(variant.baseItem, undefined);
	assert.equal(getVariantDisplayLabel(variant), '+1 Mythril Weave');
});

void test('real +1 Yklwa shape keeps generic Weapon type separate from Uncommon rarity', () => {
	const source = {
		...item('+1 Weapon', [
			'A generic +1 weapon rule remains on every concrete form.',
			'**Variants**:',
			'### +1 Yklwa',
			'- **Damage**: 1d8 piercing',
			'- **Range**: 10/30',
			'- **Properties**: Thrown',
			'- **Weight**: 3.0 lbs.',
		].join('\n')),
		detail: 'Uncommon',
		rarity: 'uncommon',
		rawTags: ['ttrpg-cli/item/weapon/martial'],
	};
	const variant = discoverItemVariants(source, [source])[0];
	assert.ok(variant);
	assert.equal(variant.baseItem, undefined);
	assert.equal(variant.item.typeText, 'Weapon');
	assert.equal(variant.item.rarityText, 'Uncommon');
	assert.equal(variant.item.damage, '1d8 piercing');
	assert.deepEqual(variant.item.properties, ['Thrown']);
	assert.equal(variant.item.range, '10/30');
	assert.equal(variant.item.weight, 3);
	assert.match(variant.item.description, /generic \+1 weapon rule/iu);
});

void test('magic attunement qualifiers survive real-shaped weapon and armor variants', () => {
	const cases = [
		{
			sourceName: 'Blade of Retribution',
			detail: 'Rare (requires attunement by a paladin)',
			heading: 'Longsword of Retribution',
			base: { ...item('Longsword'), detail: 'Weapon' },
			expected: 'Requires attunement by a paladin',
		},
		{
			sourceName: 'Holy Avenger',
			detail: 'Legendary (requires attunement by a paladin)',
			heading: 'Holy Avenger Longsword',
			base: { ...item('Longsword'), detail: 'Weapon' },
			expected: 'Requires attunement by a paladin',
		},
		{
			sourceName: 'Inexhaustible Armor',
			detail: 'Very rare (requires attunement by a fighter)',
			heading: 'Inexhaustible Breastplate',
			base: { ...item('Breastplate'), detail: 'Armor' },
			expected: 'Requires attunement by a fighter',
		},
	] as const;
	for (const entry of cases) {
		const source = {
			...item(entry.sourceName, [
				'Magic rules.',
				'**Variants**:',
				`### ${entry.heading}`,
				'- **Weight**: 3 lbs.',
			].join('\n')),
			detail: entry.detail,
			attunement: true,
		};
		const variant = discoverItemVariants(source, [source, entry.base])[0];
		assert.equal(variant?.item.attunementText, entry.expected, entry.sourceName);
		assert.equal(getStructuredItemFieldOrigin(variant?.item ?? source, 'attunementText'), 'source');
	}
});

void test('attunement precedence preserves generic and none while explicit overrides win', () => {
	const base = { ...item('Longsword'), detail: 'Weapon' };
	const generic = {
		...item('Generic Blade', 'Rules\n**Variants**:\n### Generic Blade Longsword'),
		detail: 'Rare (requires attunement)',
		attunement: true,
	};
	const none = item('Unattuned Blade', 'Rules\n**Variants**:\n### Unattuned Blade Longsword');
	const genericVariant = discoverItemVariants(generic, [generic, base])[0];
	const noneVariant = discoverItemVariants(none, [none, base])[0];
	assert.equal(genericVariant?.item.attunementText, 'Requires attunement');
	assert.equal(noneVariant?.item.attunementText, undefined);
	assert.equal(
		applyCardOverrides(genericVariant?.item ?? generic, {
			attunementText: 'Requires attunement by the card owner',
		}).item.attunementText,
		'Requires attunement by the card owner',
	);
});

void test('Armor of Cold Resistance uses canonical base labels and base provenance', () => {
	const baseNames = [
		'Breastplate',
		'Chain Mail',
		'Chain Shirt',
		'Half Plate Armor',
		'Hide Armor',
		'Padded Armor',
		'Plate Armor',
		'Ring Mail',
		'Scale Mail',
		'Splint Armor',
		'Studded Leather Armor',
	] as const;
	const bases = baseNames.map((name, index) => ({
		...item(name),
		detail: 'Armor',
		cost: `${10 + index} gp`,
		weight: 20 + index,
	}));
	const source = {
		...item('Armor of Cold Resistance', [
			'Magic resistance rule.',
			'**Variants**:',
			...baseNames.flatMap((name) => [
				`### ${name} of Cold Resistance`,
				'- **Armor Class**: source value',
			]),
		].join('\n')),
		detail: 'Rare (requires attunement)',
		rarity: 'rare',
		attunement: true,
	};
	const variants = discoverItemVariants(source, [source, ...bases]);
	assert.deepEqual(variants.map(getVariantDisplayLabel), [...baseNames]);
	for (const variant of variants) {
		assert.equal(variant.item.rarityText, 'Rare');
		assert.equal(variant.item.attunementText, 'Requires attunement');
		assert.equal(getStructuredItemFieldOrigin(variant.item, 'cost'), 'base');
		assert.equal(buildItemStatRows(variant.item).some((row) => row.label === 'Cost'), false);
		assert.equal(buildItemStatRows(variant.item).some((row) => row.label === 'Weight'), true);
	}
});

void test("Monster Hunter's Weapon selectors use concise resolved bases without changing titles", () => {
	const baseNames = ['Dagger', 'Halberd', 'Heavy Crossbow', 'Hunting Rifle'] as const;
	const bases = baseNames.map((name) => ({ ...item(name), detail: 'Weapon' }));
	const source = item("Monster Hunter's Weapon +1", [
		'Magic hunter rules.',
		'**Variants**:',
		...baseNames.flatMap((name) => [
			`### Monster Hunter's ${name} +1`,
			'- **Damage**: 1d8 piercing',
		]),
	].join('\n'));
	const variants = discoverItemVariants(source, [source, ...bases]);
	assert.deepEqual(variants.map(getVariantDisplayLabel), [...baseNames]);
	assert.deepEqual(
		variants.map((variant) => variant.item.name),
		baseNames.map((name) => `Monster Hunter's ${name} +1`),
	);
});

void test('inherited mundane Cost stays editable but is hidden until explicitly overridden', () => {
	const quarterstaff = {
		...item('Quarterstaff'),
		detail: 'Weapon',
		damage: '1d6 bludgeoning',
		damageTwoHanded: '1d8 bludgeoning',
		properties: ['Versatile'],
		mastery: 'Topple',
		cost: '2 sp',
		weight: 4,
	};
	const source = {
		...item('+1 Weapon', [
			'Magic bonus rule.',
			'**Variants**:',
			'### +1 Quarterstaff',
		].join('\n')),
		rarity: 'uncommon',
		rawTags: ['ttrpg-cli/item/weapon/martial'],
	};
	const variant = discoverItemVariants(source, [source, quarterstaff])[0];
	assert.ok(variant);
	assert.equal(variant.item.cost, '2 sp');
	assert.equal(getStructuredItemFieldOrigin(variant.item, 'cost'), 'base');
	assert.deepEqual(buildItemStatRows(variant.item).map((row) => row.label), [
		'Damage',
		'Properties',
		'Mastery',
		'Weight',
	]);
	const explicit = applyCardOverrides(variant.item, { stats: { cost: '15000 gp' } }).item;
	assert.equal(getStructuredItemFieldOrigin(explicit, 'cost'), 'override');
	assert.deepEqual(buildItemStatRows(explicit).at(-1), {
		label: 'Cost',
		values: ['15000 gp'],
	});
});
